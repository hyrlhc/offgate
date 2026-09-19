#![cfg(test)]
extern crate std;

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events},
    token::StellarAssetClient,
    Address, BytesN, Env, Symbol, Vec,
};

/// 100.00 TL gecis ucreti, kurus cinsinden.
const FARE: i128 = 10_000;
/// 1 USDC = 48.785078 TRY, 10^7 olcekli.
const RATE: i128 = 487_850_780;
/// Bir gecisin USDC stroop karsiligi.
const FARE_STROOPS: i128 = 20_498_071;
/// Demoda kilitlenen tutar: ~10.2 USDC, 4 gecise yeter.
const LOCK: i128 = 102_000_000;

const EVT: Symbol = symbol_short!("EVT1");
const G1: Symbol = symbol_short!("M307");
const G2: Symbol = symbol_short!("M308");
const G3: Symbol = symbol_short!("M309");

// --- Test tezgahi ----------------------------------------------------------

struct Fix<'a> {
    e: Env,
    client: OffGateClient<'a>,
    token: Address,
    admin: Address,
    operator: Address,
}

fn setup() -> Fix<'static> {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let operator = Address::generate(&e);
    let sac = e.register_stellar_asset_contract_v2(admin.clone());
    let token = sac.address();

    let id = e.register(OffGate, ());
    let client = OffGateClient::new(&e, &id);
    client.init(&admin, &operator, &token, &BytesN::from_array(&e, &[7u8; 32]));

    Fix { e, client, token, admin, operator }
}

/// Telefonda uretilen cihaz anahtari (karar K-1).
struct Device {
    key: SigningKey,
}

impl Device {
    fn new(seed: u8) -> Self {
        Device { key: SigningKey::from_bytes(&[seed; 32]) }
    }
    fn pk(&self, e: &Env) -> BytesN<32> {
        BytesN::from_array(e, &self.key.verifying_key().to_bytes())
    }
}

impl Fix<'_> {
    fn user(&self, usdc: i128) -> Address {
        let u = Address::generate(&self.e);
        StellarAssetClient::new(&self.e, &self.token).mint(&u, &usdc);
        u
    }
    fn balance(&self, who: &Address) -> i128 {
        soroban_sdk::token::Client::new(&self.e, &self.token).balance(who)
    }
    fn ent_hash(&self, seed: u8) -> BytesN<32> {
        BytesN::from_array(&self.e, &[seed; 32])
    }

    /// Kapiya baglanmis, fis uretmeye hazir bir kullanici.
    fn lock(&self, dev: &Device, ent: &BytesN<32>, gate: &Symbol) -> Address {
        let u = self.user(LOCK * 2);
        self.client.lock_float(
            &u, &LOCK, &EVT, gate, &FARE, &RATE, &dev.pk(&self.e), ent,
        );
        u
    }

    /// Kanonik 67 baytlik mesaji uretir — kontrattaki `receipt_message` ile
    /// birebir ayni sira ve olcek (karar K-4).
    fn canonical(&self, ent: &BytesN<32>, seq: u32, fare_try: i128, ts: u64) -> std::vec::Vec<u8> {
        let mut m = std::vec::Vec::with_capacity(67);
        m.extend_from_slice(RCPT_DOMAIN);
        m.extend_from_slice(&ent.to_array());
        m.extend_from_slice(&seq.to_be_bytes());
        m.extend_from_slice(&(fare_try as u64).to_be_bytes());
        m.extend_from_slice(&ts.to_be_bytes());
        assert_eq!(m.len(), 67);
        m
    }

    fn receipt(&self, dev: &Device, user: &Address, ent: &BytesN<32>, seq: u32, ts: u64) -> Receipt {
        let msg = self.canonical(ent, seq, FARE, ts);
        let sig = dev.key.sign(&msg).to_bytes();
        Receipt {
            ent_hash: ent.clone(),
            user: user.clone(),
            seq,
            fare_try: FARE,
            ts,
            sig: BytesN::from_array(&self.e, &sig),
        }
    }

    fn batch(&self, rs: &[Receipt]) -> Vec<Receipt> {
        let mut v = Vec::new(&self.e);
        for r in rs {
            v.push_back(r.clone());
        }
        v
    }
}

// --- Kurulum ---------------------------------------------------------------

#[test]
fn init_stores_config_and_rejects_second_call() {
    let f = setup();
    assert_eq!(f.client.admin(), f.admin);
    assert_eq!(f.client.operator(), f.operator);
    assert_eq!(f.client.token(), f.token);
    assert_eq!(f.client.version(), 1);
    assert!(f
        .client
        .try_init(&f.admin, &f.operator, &f.token, &f.ent_hash(1))
        .is_err());
}

#[test]
fn register_gate_adds_once_and_rejects_duplicate() {
    let f = setup();
    f.client.register_gate(&EVT, &G1);
    f.client.register_gate(&EVT, &G2);
    assert_eq!(f.client.gates_of(&EVT).len(), 2);
    assert!(f.client.try_register_gate(&EVT, &G1).is_err());
    assert_eq!(f.client.gates_of(&EVT).len(), 2);
}

/// Bir kapi iki etkinlige birden kayitli olamaz.
///
/// Sayaclar (Declared/Settled) kapi bazinda tutuluyor; ayni kapi iki
/// etkinlikte olsaydi `stats` bir etkinligin gecislerini digerine de
/// sayar ve denetim ekrani yanlis sonuc verirdi.
#[test]
fn gate_belongs_to_exactly_one_event() {
    let f = setup();
    let other = Symbol::new(&f.e, "FEST26");

    f.client.register_gate(&EVT, &G1);
    assert_eq!(f.client.event_of(&G1), Some(EVT));

    assert!(
        f.client.try_register_gate(&other, &G1).is_err(),
        "ayni kapi ikinci bir etkinlige kaydedilememeli"
    );
    assert_eq!(f.client.gates_of(&other).len(), 0);

    // Farkli bir kapi o etkinlige girebilir.
    f.client.register_gate(&other, &G2);
    assert_eq!(f.client.event_of(&G2), Some(other));
}

// --- lock_float ------------------------------------------------------------

#[test]
fn lock_float_moves_usdc_and_binds_gate() {
    let f = setup();
    f.client.register_gate(&EVT, &G1);
    let dev = Device::new(3);
    let ent = f.ent_hash(0xAA);

    let u = f.user(LOCK * 2);
    let assigned = f
        .client
        .lock_float(&u, &LOCK, &EVT, &G1, &FARE, &RATE, &dev.pk(&f.e), &ent);

    let emitted = f.e.events().all();
    assert!(!emitted.events().is_empty(), "FloatLocked yayinlanmali");

    assert_eq!(assigned, G1);
    assert_eq!(f.client.float_of(&u), LOCK);
    assert_eq!(f.client.gate_load(&G1), 1);
    assert_eq!(f.balance(&f.client.address), LOCK, "USDC kontrata gecmeli");
    assert_eq!(f.client.uses_left(&u), 4);

    let a = f.client.account_of(&u);
    assert_eq!(a.device_pk, dev.pk(&f.e));
    assert_eq!(a.ent_hash, ent);
    assert_eq!(a.gate, G1);
}

#[test]
fn lock_float_rejects_unregistered_gate_and_moves_no_money() {
    let f = setup();
    f.client.register_gate(&EVT, &G1);
    let dev = Device::new(4);
    let u = f.user(LOCK * 2);
    let before = f.balance(&u);

    assert!(f
        .client
        .try_lock_float(&u, &LOCK, &EVT, &G2, &FARE, &RATE, &dev.pk(&f.e), &f.ent_hash(2))
        .is_err());
    assert_eq!(f.balance(&u), before, "reddedilen kapida para hareket etmemeli");
}

#[test]
fn lock_float_enforces_load_balance_on_chain() {
    let f = setup();
    f.client.register_gate(&EVT, &G1);
    f.client.register_gate(&EVT, &G2);
    let dev = Device::new(5);

    // G1'i tolerans sinirina kadar doldur (0 -> 3, min yuk hala 0).
    for i in 0..=GATE_LOAD_TOLERANCE {
        f.lock(&dev, &f.ent_hash(0x10 + i as u8), &G1);
    }
    assert_eq!(f.client.gate_load(&G1), GATE_LOAD_TOLERANCE + 1);

    // Bir sonraki kullanici G1'i secemez: bos duran G2 varken dengeyi bozar.
    let u = f.user(LOCK * 2);
    assert!(f
        .client
        .try_lock_float(&u, &LOCK, &EVT, &G1, &FARE, &RATE, &dev.pk(&f.e), &f.ent_hash(0x20))
        .is_err());
    // G2 kabul edilir.
    f.client
        .lock_float(&u, &LOCK, &EVT, &G2, &FARE, &RATE, &dev.pk(&f.e), &f.ent_hash(0x20));
    assert_eq!(f.client.gate_load(&G2), 1);
}

#[test]
fn lock_float_rejects_amount_below_one_fare() {
    let f = setup();
    f.client.register_gate(&EVT, &G1);
    let dev = Device::new(6);
    let u = f.user(LOCK);
    let before = f.balance(&u);
    assert!(f
        .client
        .try_lock_float(&u, &10_000_000, &EVT, &G1, &FARE, &RATE, &dev.pk(&f.e), &f.ent_hash(3))
        .is_err());
    assert_eq!(f.balance(&u), before);
}

#[test]
fn lock_float_rejects_second_lock_for_same_user() {
    let f = setup();
    f.client.register_gate(&EVT, &G1);
    let dev = Device::new(7);
    let ent = f.ent_hash(4);
    let u = f.lock(&dev, &ent, &G1);
    assert!(f
        .client
        .try_lock_float(&u, &LOCK, &EVT, &G1, &FARE, &RATE, &dev.pk(&f.e), &ent)
        .is_err());
    assert_eq!(f.client.gate_load(&G1), 1);
}

#[test]
#[should_panic]
fn lock_float_requires_user_auth() {
    let f = setup();
    f.client.register_gate(&EVT, &G1);
    let dev = Device::new(8);
    let u = f.user(LOCK * 2);

    f.e.set_auths(&[]); // Yetkilendirmeyi kaldir.
    f.client
        .lock_float(&u, &LOCK, &EVT, &G1, &FARE, &RATE, &dev.pk(&f.e), &f.ent_hash(5));
}

// --- settle ----------------------------------------------------------------

#[test]
fn settle_accepts_valid_receipts_and_pays_operator() {
    let f = setup();
    f.client.register_gate(&EVT, &G1);
    let dev = Device::new(11);
    let ent = f.ent_hash(0xB1);
    let u = f.lock(&dev, &ent, &G1);

    let rs = f.batch(&[
        f.receipt(&dev, &u, &ent, 1, 1_700_000_001),
        f.receipt(&dev, &u, &ent, 2, 1_700_000_002),
        f.receipt(&dev, &u, &ent, 3, 1_700_000_003),
    ]);
    assert_eq!(f.client.settle(&G1, &rs), 3);

    assert_eq!(f.balance(&f.operator), FARE_STROOPS * 3, "hasilat operatore gecmeli");
    assert_eq!(f.client.float_of(&u), LOCK - FARE_STROOPS * 3);
    assert_eq!(f.client.uses_left(&u), 1);
    assert_eq!(f.client.settled_of(&G1), 3);
    assert!(f.client.is_spent(&ent, &1));
    assert!(!f.client.is_spent(&ent, &4));
}

#[test]
fn settle_is_idempotent_for_repeated_batches() {
    let f = setup();
    f.client.register_gate(&EVT, &G1);
    let dev = Device::new(12);
    let ent = f.ent_hash(0xB2);
    let u = f.lock(&dev, &ent, &G1);

    let rs = f.batch(&[
        f.receipt(&dev, &u, &ent, 1, 1_700_000_001),
        f.receipt(&dev, &u, &ent, 2, 1_700_000_002),
    ]);
    assert_eq!(f.client.settle(&G1, &rs), 2);
    let after_first = f.client.float_of(&u);

    // Gorevli ayni senkronizasyonu iki kez calistirdi: batch dusmemeli.
    assert_eq!(f.client.settle(&G1, &rs), 0, "ayni fisler tekrar sayilmamali");
    assert_eq!(f.client.float_of(&u), after_first);
    assert_eq!(f.balance(&f.operator), FARE_STROOPS * 2);
}

#[test]
fn settle_rejects_replayed_sequence_number() {
    let f = setup();
    f.client.register_gate(&EVT, &G1);
    let dev = Device::new(13);
    let ent = f.ent_hash(0xB3);
    let u = f.lock(&dev, &ent, &G1);

    assert_eq!(f.client.settle(&G1, &f.batch(&[f.receipt(&dev, &u, &ent, 1, 1)])), 1);
    // Ayni seq, farkli zaman damgasi ve gecerli imza — yine de reddedilmeli.
    assert_eq!(
        f.client.settle(&G1, &f.batch(&[f.receipt(&dev, &u, &ent, 1, 999)])),
        0,
        "tekrar saldirisi seq ile engellenmeli"
    );
    assert_eq!(f.client.float_of(&u), LOCK - FARE_STROOPS);
}

#[test]
fn settle_skips_receipts_from_another_gate() {
    let f = setup();
    f.client.register_gate(&EVT, &G1);
    f.client.register_gate(&EVT, &G2);
    let dev = Device::new(14);
    let ent = f.ent_hash(0xB4);
    let u = f.lock(&dev, &ent, &G1); // G1'e bagli

    let rs = f.batch(&[f.receipt(&dev, &u, &ent, 1, 1)]);
    assert_eq!(f.client.settle(&G2, &rs), 0, "baska kapinin fisi sayilmamali");
    assert_eq!(f.client.float_of(&u), LOCK);
    assert_eq!(f.balance(&f.operator), 0);
}

#[test]
fn settle_skips_receipt_with_mismatched_entitlement() {
    let f = setup();
    f.client.register_gate(&EVT, &G1);
    let dev = Device::new(15);
    let ent = f.ent_hash(0xB5);
    let u = f.lock(&dev, &ent, &G1);

    // Gecerli imzali ama baska bir bilete ait fis.
    let other = f.ent_hash(0xC5);
    let rs = f.batch(&[f.receipt(&dev, &u, &other, 1, 1)]);
    assert_eq!(f.client.settle(&G1, &rs), 0);
    assert_eq!(f.client.float_of(&u), LOCK);
}

#[test]
fn settle_stops_when_balance_is_exhausted() {
    let f = setup();
    f.client.register_gate(&EVT, &G1);
    let dev = Device::new(16);
    let ent = f.ent_hash(0xB6);
    let u = f.lock(&dev, &ent, &G1); // 4 gecise yeter

    let mut rs = std::vec::Vec::new();
    for seq in 1..=6u32 {
        rs.push(f.receipt(&dev, &u, &ent, seq, 1_700_000_000 + seq as u64));
    }
    assert_eq!(f.client.settle(&G1, &f.batch(&rs)), 4, "bakiye yalnizca 4 gecise yeter");
    assert_eq!(f.balance(&f.operator), FARE_STROOPS * 4);
    assert!(f.client.float_of(&u) < FARE_STROOPS);
}

#[test]
fn settle_rejects_forged_signature() {
    let f = setup();
    f.client.register_gate(&EVT, &G1);
    let dev = Device::new(17);
    let ent = f.ent_hash(0xB7);
    let u = f.lock(&dev, &ent, &G1);

    // Baska bir cihaz anahtariyla imzalanmis fis.
    let attacker = Device::new(99);
    let mut forged = f.receipt(&attacker, &u, &ent, 1, 1);
    forged.user = u.clone();

    assert!(
        f.client.try_settle(&G1, &f.batch(&[forged])).is_err(),
        "gecersiz imza batch'i durdurmali"
    );
    assert_eq!(f.client.float_of(&u), LOCK, "hicbir bakiye harcanmamali");
    assert_eq!(f.balance(&f.operator), 0);
}

#[test]
fn settle_rejects_tampered_amount() {
    let f = setup();
    f.client.register_gate(&EVT, &G1);
    let dev = Device::new(18);
    let ent = f.ent_hash(0xB8);
    let u = f.lock(&dev, &ent, &G1);

    // Ucreti dusurmeye calis: imza eski ucret uzerinden atildi.
    let mut tampered = f.receipt(&dev, &u, &ent, 1, 1);
    tampered.fare_try = 1;
    assert_eq!(f.client.settle(&G1, &f.batch(&[tampered])), 0);
    assert_eq!(f.client.float_of(&u), LOCK);
}

// --- Denetim ---------------------------------------------------------------

#[test]
fn stats_expose_declared_versus_settled() {
    let f = setup();
    f.client.register_gate(&EVT, &G1);
    let dev = Device::new(21);
    let ent = f.ent_hash(0xD1);
    let u = f.lock(&dev, &ent, &G1);

    f.client.settle(
        &G1,
        &f.batch(&[
            f.receipt(&dev, &u, &ent, 1, 1),
            f.receipt(&dev, &u, &ent, 2, 2),
        ]),
    );
    f.client.gate_report(&G1, &2);

    let (declared, settled, revenue) = f.client.stats(&EVT);
    assert_eq!(declared, 2);
    assert_eq!(settled, 2);
    assert_eq!(revenue, FARE_STROOPS * 2);
    assert_eq!(declared, settled, "beyan ile zincir tutmali");
}

#[test]
fn stats_reveal_underreporting_gate() {
    let f = setup();
    f.client.register_gate(&EVT, &G1);
    let dev = Device::new(22);
    let ent = f.ent_hash(0xD2);
    let u = f.lock(&dev, &ent, &G1);

    f.client.settle(&G1, &f.batch(&[f.receipt(&dev, &u, &ent, 1, 1)]));
    f.client.gate_report(&G1, &5); // Kapi 5 gecis beyan etti, zincirde 1 fis var.

    let (declared, settled, _) = f.client.stats(&EVT);
    assert_ne!(declared, settled, "eksik beyan denetimde gorunmeli");
}

// --- refund ----------------------------------------------------------------

#[test]
fn refund_returns_remainder_and_frees_gate_slot() {
    let f = setup();
    f.client.register_gate(&EVT, &G1);
    let dev = Device::new(31);
    let ent = f.ent_hash(0xE1);
    let u = f.lock(&dev, &ent, &G1);
    let spent_before = f.balance(&u);

    f.client.settle(&G1, &f.batch(&[f.receipt(&dev, &u, &ent, 1, 1)]));
    let expected = LOCK - FARE_STROOPS;

    assert_eq!(f.client.refund(&u), expected);
    assert_eq!(f.balance(&u), spent_before + expected);
    assert_eq!(f.client.gate_load(&G1), 0, "kapi slotu bosalmali");
    assert!(f.client.try_account_of(&u).is_err());
}

#[test]
fn refund_keeps_spent_receipts_unusable_after_relock() {
    let f = setup();
    f.client.register_gate(&EVT, &G1);
    let dev = Device::new(32);
    let ent = f.ent_hash(0xE2);
    let u = f.lock(&dev, &ent, &G1);

    let r1 = f.receipt(&dev, &u, &ent, 1, 1);
    f.client.settle(&G1, &f.batch(&[r1.clone()]));
    f.client.refund(&u);

    // Ayni entitlement ile tekrar kilitle.
    f.client
        .lock_float(&u, &LOCK, &EVT, &G1, &FARE, &RATE, &dev.pk(&f.e), &ent);
    // Eski fis hala harcanmis sayilmali.
    assert_eq!(f.client.settle(&G1, &f.batch(&[r1])), 0);
    assert_eq!(f.client.float_of(&u), LOCK);
}

#[test]
#[should_panic]
fn refund_requires_user_auth() {
    let f = setup();
    f.client.register_gate(&EVT, &G1);
    let dev = Device::new(33);
    let u = f.lock(&dev, &f.ent_hash(0xE3), &G1);
    f.e.set_auths(&[]);
    f.client.refund(&u);
}

// --- Kapi atamasi ----------------------------------------------------------

#[test]
fn assign_gate_spreads_load_evenly() {
    let f = setup();
    for g in [&G1, &G2, &G3] {
        f.client.register_gate(&EVT, g);
    }
    let dev = Device::new(41);
    for i in 0..6u8 {
        let gate = f.client.assign_gate(&EVT);
        f.lock(&dev, &f.ent_hash(0x40 + i), &gate);
    }
    for g in [&G1, &G2, &G3] {
        assert_eq!(f.client.gate_load(g), 2, "kapi yuku dengeli olmali");
    }
}

#[test]
fn assign_gate_fails_for_unknown_event() {
    let f = setup();
    assert!(f.client.try_assign_gate(&Symbol::new(&f.e, "YOKEVENT")).is_err());
}

// --- Ucret matematigi ------------------------------------------------------

#[test]
fn fare_conversion_holds_try_price_constant() {
    assert_eq!(fare_in_stroops(FARE, RATE), FARE_STROOPS);
    // Kur yukselirse ayni 100 TL daha az USDC eder; TL fiyati degismez.
    let at_60 = fare_in_stroops(FARE, 600_000_000);
    assert_eq!(at_60, 16_666_666);
    assert!(at_60 < FARE_STROOPS);
}

/// Kanonik mesaj uzunlugu uc platformda da 67 bayt olmali (karar K-4/K-8).
#[test]
fn canonical_message_is_exactly_67_bytes() {
    let f = setup();
    assert_eq!(f.canonical(&f.ent_hash(1), 1, FARE, 1).len(), 67);
    let e = &f.e;
    assert_eq!(
        receipt_message(e, &f.ent_hash(1), 1, FARE, 1).len(),
        67
    );
}

/// Platformlar arasi kanonik format kaniti (karar K-4 / K-8).
///
/// Asagidaki degerler `scripts/gen-test-vector.mjs` tarafindan Node'da
/// uretildi. Rust tarafi ayni baytlari ve ayni imzayi uretmezse bu test
/// kirilir — yani sozlesme, web ve firmware'in ayni formati konustugu
/// derleme zamaninda garanti altina alinir.
#[test]
fn canonical_message_matches_javascript_vector() {
    let f = setup();
    let ent = BytesN::from_array(&f.e, &[0xAB; 32]);

    let msg = receipt_message(&f.e, &ent, 1, 10_000, 1_700_000_001);
    let mut bytes = std::vec::Vec::new();
    for b in msg.iter() {
        bytes.push(b);
    }

    assert_eq!(
        hex::encode(&bytes),
        "4f4646474154452d524350542d7631\
abababababababababababababababababababababababababababababababab\
00000001\
0000000000002710\
000000006553f101",
        "kanonik mesaj JavaScript ile ayni olmali"
    );

    let key = SigningKey::from_bytes(&[0x11u8; 32]);
    assert_eq!(
        hex::encode(key.verifying_key().to_bytes()),
        "d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737",
        "ayni tohumdan ayni acik anahtar cikmali"
    );
    assert_eq!(
        hex::encode(key.sign(&bytes).to_bytes()),
        "5e7623fbf168a4cff62a98b524e8cd2c36855fb2107d231b674d6bfdd44f14ae\
16e70d6e62cf551df1dad4f2b491e33775b7982c0c841e08bd7bc412dcec750c",
        "ayni mesaj ayni imzayi uretmeli"
    );
}
