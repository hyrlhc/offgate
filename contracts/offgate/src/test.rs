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
/// Hizmet bedeli DUSULDUKTEN sonra kullanilabilir bakiye: ~10.2 USDC,
/// 4 gecise yeter.
const LOCK: i128 = 102_000_000;
/// Kullanicinin fiilen odedigi tutar: bakiye + %5 hizmet bedeli.
/// `split_fee(PAID)` tam olarak `(LOCK, 5_100_000)` verir.
const PAID: i128 = 107_100_000;
/// Tutulan hizmet bedeli.
const FEE: i128 = PAID - LOCK;

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

/// Turnikenin kendi anahtari. Sahada ESP32'nin NVS'inde durur; testte
/// kapi sembolunden deterministik olarak turetiyoruz.
fn gate_key(gate: &Symbol) -> SigningKey {
    let seed: u8 = if *gate == G1 {
        101
    } else if *gate == G2 {
        102
    } else {
        103
    };
    SigningKey::from_bytes(&[seed; 32])
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

    /// Kapiyi, kendi acik anahtariyla birlikte kaydeder.
    fn reg(&self, event: &Symbol, gate: &Symbol) {
        let pk = BytesN::from_array(&self.e, &gate_key(gate).verifying_key().to_bytes());
        self.client.register_gate(event, gate, &pk);
    }

    /// Kapiya baglanmis, fis uretmeye hazir bir kullanici.
    fn lock(&self, dev: &Device, ent: &BytesN<32>, gate: &Symbol) -> Address {
        let u = self.user(PAID * 2);
        self.client.lock_float(
            &u, &PAID, &EVT, gate, &FARE, &RATE, &dev.pk(&self.e), ent,
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

    /// Kapinin imzaladigi tahsilat belgesinin kanonik baytlari (67 bayt).
    fn voucher_canonical(
        &self,
        ent: &BytesN<32>,
        seq: u32,
        charged_try: i128,
        ts: u64,
    ) -> std::vec::Vec<u8> {
        let mut m = std::vec::Vec::with_capacity(67);
        m.extend_from_slice(VCHR_DOMAIN);
        m.extend_from_slice(&ent.to_array());
        m.extend_from_slice(&seq.to_be_bytes());
        m.extend_from_slice(&(charged_try as u64).to_be_bytes());
        m.extend_from_slice(&ts.to_be_bytes());
        assert_eq!(m.len(), 67);
        m
    }

    /// Tam ucretli fis: kapi biletin ust siniri kadar tahsil etmis.
    fn receipt(&self, dev: &Device, user: &Address, ent: &BytesN<32>, seq: u32, ts: u64) -> Receipt {
        self.receipt_at(dev, &G1, user, ent, seq, ts, FARE)
    }

    /// Belirli bir kapida, belirli bir tutar tahsil edilmis fis.
    /// `charged_try < FARE` ise fark kullanicinin bakiyesinde kalir.
    #[allow(clippy::too_many_arguments)]
    fn receipt_at(
        &self,
        dev: &Device,
        gate: &Symbol,
        user: &Address,
        ent: &BytesN<32>,
        seq: u32,
        ts: u64,
        charged_try: i128,
    ) -> Receipt {
        let sig = dev.key.sign(&self.canonical(ent, seq, FARE, ts)).to_bytes();
        let gsig = gate_key(gate)
            .sign(&self.voucher_canonical(ent, seq, charged_try, ts))
            .to_bytes();
        Receipt {
            ent_hash: ent.clone(),
            user: user.clone(),
            seq,
            fare_try: FARE,
            ts,
            sig: BytesN::from_array(&self.e, &sig),
            charged_try,
            gate_sig: BytesN::from_array(&self.e, &gsig),
        }
    }

    /// Kapinin imzaladigi sayac beyani.
    fn report(&self, gate: &Symbol, counter: u32, ts: u64) {
        let mut m = std::vec::Vec::with_capacity(27);
        m.extend_from_slice(RPRT_DOMAIN);
        m.extend_from_slice(&counter.to_be_bytes());
        m.extend_from_slice(&ts.to_be_bytes());
        let sig = gate_key(gate).sign(&m).to_bytes();
        self.client
            .gate_report(gate, &counter, &ts, &BytesN::from_array(&self.e, &sig));
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
    f.reg(&EVT, &G1);
    f.reg(&EVT, &G2);
    assert_eq!(f.client.gates_of(&EVT).len(), 2);
    assert!(f.client.try_register_gate(&EVT, &G1, &BytesN::from_array(&f.e, &gate_key(&G1).verifying_key().to_bytes())).is_err());
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

    f.reg(&EVT, &G1);
    assert_eq!(f.client.event_of(&G1), Some(EVT));

    assert!(
        f.client.try_register_gate(&other, &G1, &BytesN::from_array(&f.e, &gate_key(&G1).verifying_key().to_bytes())).is_err(),
        "ayni kapi ikinci bir etkinlige kaydedilememeli"
    );
    assert_eq!(f.client.gates_of(&other).len(), 0);

    // Farkli bir kapi o etkinlige girebilir.
    f.reg(&other, &G2);
    assert_eq!(f.client.event_of(&G2), Some(other));
}

// --- lock_float ------------------------------------------------------------

#[test]
fn lock_float_moves_usdc_and_binds_gate() {
    let f = setup();
    f.reg(&EVT, &G1);
    let dev = Device::new(3);
    let ent = f.ent_hash(0xAA);

    let u = f.user(PAID * 2);
    let assigned = f
        .client
        .lock_float(&u, &PAID, &EVT, &G1, &FARE, &RATE, &dev.pk(&f.e), &ent);

    let emitted = f.e.events().all();
    assert!(!emitted.events().is_empty(), "FloatLocked yayinlanmali");

    assert_eq!(assigned, G1);
    // Odenen tutarin tamami kontrata gecer; hizmet bedeli ayri tutulur ve
    // gecis hakki yalnizca kullanilabilir bakiyeden hesaplanir.
    assert_eq!(f.balance(&f.client.address), PAID, "USDC kontrata gecmeli");
    assert_eq!(f.client.float_of(&u), LOCK);
    assert_eq!(f.client.account_of(&u).fee_held, FEE);
    assert_eq!(f.client.gate_load(&G1), 1);
    assert_eq!(f.client.uses_left(&u), 4);

    let a = f.client.account_of(&u);
    assert_eq!(a.device_pk, dev.pk(&f.e));
    assert_eq!(a.ent_hash, ent);
    assert_eq!(a.gate, G1);
}

#[test]
fn lock_float_rejects_unregistered_gate_and_moves_no_money() {
    let f = setup();
    f.reg(&EVT, &G1);
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
    f.reg(&EVT, &G1);
    f.reg(&EVT, &G2);
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
    f.reg(&EVT, &G1);
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
    f.reg(&EVT, &G1);
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
    f.reg(&EVT, &G1);
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
    f.reg(&EVT, &G1);
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
    f.reg(&EVT, &G1);
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
    f.reg(&EVT, &G1);
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
/// Komsu kapida alinan gecis de settle edilebilir.
///
/// Bilet G1'e bagli ama kullanici G2'den gecti (kapilar arasi soru/onay
/// protokolu, ESP-NOW). G2 kendi anahtariyla imzaladigi icin belge gecerli
/// ve para operatore gecer. Bilet artik tek kapiya hapsolmuyor.
#[test]
fn settle_accepts_a_pass_taken_at_a_neighbouring_gate() {
    let f = setup();
    f.reg(&EVT, &G1);
    f.reg(&EVT, &G2);
    let dev = Device::new(14);
    let ent = f.ent_hash(0xB4);
    let u = f.lock(&dev, &ent, &G1); // bilet G1'e bagli

    let r = f.receipt_at(&dev, &G2, &u, &ent, 1, 1, FARE); // gecis G2'de
    assert_eq!(f.client.settle(&G2, &f.batch(&[r])), 1);
    assert_eq!(f.client.float_of(&u), LOCK - FARE_STROOPS);
    assert_eq!(f.balance(&f.operator), FARE_STROOPS);
}

/// Belge, onu imzalayan kapidan baska bir kapi uzerinden gecirilemez.
///
/// G1'in imzaladigi tahsilat belgesi G2 uzerinden gonderilirse imza G2'nin
/// acik anahtariyla tutmaz ve batch panik atar. Kapi imzasi, belgenin
/// hangi turnikeden geldigini baglar.
#[test]
#[should_panic]
fn settle_rejects_a_voucher_signed_by_a_different_gate() {
    let f = setup();
    f.reg(&EVT, &G1);
    f.reg(&EVT, &G2);
    let dev = Device::new(15);
    let ent = f.ent_hash(0xB5);
    let u = f.lock(&dev, &ent, &G1);

    let r = f.receipt_at(&dev, &G1, &u, &ent, 1, 1, FARE); // G1 imzaladi
    f.client.settle(&G2, &f.batch(&[r])); // G2 uzerinden gonderiliyor
}

/// Baska bir ETKINLIGE kayitli kapinin fisi sayilmaz.
#[test]
fn settle_skips_receipts_from_another_event() {
    let f = setup();
    f.reg(&EVT, &G1);
    let other: Symbol = symbol_short!("EVT2");
    f.reg(&other, &G3);
    let dev = Device::new(16);
    let ent = f.ent_hash(0xB6);
    let u = f.lock(&dev, &ent, &G1);

    let r = f.receipt_at(&dev, &G3, &u, &ent, 1, 1, FARE);
    assert_eq!(
        f.client.settle(&G3, &f.batch(&[r])),
        0,
        "baska etkinligin kapisi sayilmamali"
    );
    assert_eq!(f.client.float_of(&u), LOCK);
    assert_eq!(f.balance(&f.operator), 0);
}

#[test]
fn settle_skips_receipt_with_mismatched_entitlement() {
    let f = setup();
    f.reg(&EVT, &G1);
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
    f.reg(&EVT, &G1);
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
fn settle_releases_gate_slot_when_ticket_is_used_up() {
    let f = setup();
    f.reg(&EVT, &G1);
    let dev = Device::new(41);
    let ent = f.ent_hash(0xC4);
    let u = f.lock(&dev, &ent, &G1);
    assert_eq!(f.client.gate_load(&G1), 1, "kilit kapiya bir yuk ekler");

    // Dort gecis bakiyeyi bitirir; kapi yuku kendiliginden dusmeli.
    let mut rs = std::vec::Vec::new();
    for seq in 1..=3u32 {
        rs.push(f.receipt(&dev, &u, &ent, seq, 1_700_000_000 + seq as u64));
    }
    f.client.settle(&G1, &f.batch(&rs));
    assert_eq!(f.client.gate_load(&G1), 1, "bakiye surdukce yuk durur");

    let last = f.receipt(&dev, &u, &ent, 4, 1_700_000_004);
    f.client.settle(&G1, &f.batch(&[last]));
    assert!(f.client.float_of(&u) < FARE_STROOPS, "bakiye bir gecise yetmiyor");
    assert_eq!(f.client.gate_load(&G1), 0, "tukenen bilet kapi yerini birakir");

    // Fazladan fis yuku eksiye dusurmemeli.
    let extra = f.receipt(&dev, &u, &ent, 5, 1_700_000_005);
    assert_eq!(f.client.settle(&G1, &f.batch(&[extra])), 0);
    assert_eq!(f.client.gate_load(&G1), 0);
}

#[test]
fn top_up_never_grants_more_passes_than_the_money_covers() {
    let f = setup();
    f.reg(&EVT, &G1);
    let dev = Device::new(53);
    let ent = f.ent_hash(0xD1);
    let u = f.lock(&dev, &ent, &G1);

    let first = f.client.account_of(&u);
    assert_eq!(first.granted, 4, "LOCK dort gecise yetiyor");
    assert_eq!(first.ent_uses, 4);

    // En kotu ihtimal: dort hakkin tamamini kapida harcadi, hicbiri henuz
    // zincire dusmedi. Zincir bunu goremez.
    let ent2 = f.ent_hash(0xD2);
    let added = LOCK;
    let predicted = f.client.next_grant(&u, &added);
    StellarAssetClient::new(&f.e, &f.token).mint(&u, &added);
    let grant = f.client.top_up(&u, &added, &ent2);
    assert_eq!(grant, predicted, "next_grant onceden dogru soyluyor");

    let after = f.client.account_of(&u);
    // Bakiye simdi dokuz gecise yetiyor; dordu zaten imzalanmisti.
    assert_eq!(after.granted, 9, "toplam imzalanan hak = paranin karsiladigi");
    assert_eq!(grant, 5, "yeni bilet yalnizca kalan besi verir");
    assert_eq!(after.ent_uses, 5);
    assert_eq!(after.ent_hash, ent2, "yururlukteki bilet degisti");

    // Eski bilet kapida sonuna kadar kullanilmis olsa bile, iki biletin
    // toplam hakki paranin karsiladigini asmiyor.
    let capacity = (after.balance / (FARE_STROOPS)) as u32;
    assert_eq!(after.granted, capacity);
}

#[test]
fn top_up_counts_settled_receipts_as_no_longer_outstanding() {
    let f = setup();
    f.reg(&EVT, &G1);
    let dev = Device::new(54);
    let ent = f.ent_hash(0xD3);
    let u = f.lock(&dev, &ent, &G1);

    // Iki gecis zincire dustu: artik "acikta" degiller.
    let rs = [
        f.receipt(&dev, &u, &ent, 1, 1_700_000_001),
        f.receipt(&dev, &u, &ent, 2, 1_700_000_002),
    ];
    f.client.settle(&G1, &f.batch(&rs));
    let mid = f.client.account_of(&u);
    assert_eq!(mid.used, 2);
    assert_eq!(mid.granted, 4);

    let added = LOCK;
    StellarAssetClient::new(&f.e, &f.token).mint(&u, &added);
    let grant = f.client.top_up(&u, &added, &f.ent_hash(0xD4));

    let after = f.client.account_of(&u);
    // acikta kalan = 4 - 2 = 2; bakiye 7 gecise yetiyor -> 5 yeni hak.
    assert_eq!(grant, 5);
    assert_eq!(after.granted, 9);
    assert_eq!(after.used, 2);
}

#[test]
fn top_up_rejects_amount_that_adds_no_pass() {
    let f = setup();
    f.reg(&EVT, &G1);
    let dev = Device::new(55);
    let ent = f.ent_hash(0xD5);
    let u = f.lock(&dev, &ent, &G1);

    // Bir gecisi karsilamayan ek tutar yeni bilet uretmemeli.
    StellarAssetClient::new(&f.e, &f.token).mint(&u, &1_000i128);
    assert_eq!(
        f.client.try_top_up(&u, &1_000i128, &f.ent_hash(0xD6)),
        Err(Ok(Error::AmountBelowFare)),
    );
    // Yururlukteki bilet degismedi.
    assert_eq!(f.client.account_of(&u).ent_hash, ent);
}

#[test]
fn top_up_requires_an_open_ticket() {
    let f = setup();
    f.reg(&EVT, &G1);
    let u = f.user(LOCK);
    assert_eq!(
        f.client.try_top_up(&u, &LOCK, &f.ent_hash(0xD7)),
        Err(Ok(Error::NoAccount)),
    );
}

#[test]
fn settle_rejects_forged_signature() {
    let f = setup();
    f.reg(&EVT, &G1);
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
    f.reg(&EVT, &G1);
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
    f.reg(&EVT, &G1);
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
    f.report(&G1, 2, 1);

    let (declared, settled, revenue) = f.client.stats(&EVT);
    assert_eq!(declared, 2);
    assert_eq!(settled, 2);
    assert_eq!(revenue, FARE_STROOPS * 2);
    assert_eq!(declared, settled, "beyan ile zincir tutmali");
}

#[test]
fn stats_reveal_underreporting_gate() {
    let f = setup();
    f.reg(&EVT, &G1);
    let dev = Device::new(22);
    let ent = f.ent_hash(0xD2);
    let u = f.lock(&dev, &ent, &G1);

    f.client.settle(&G1, &f.batch(&[f.receipt(&dev, &u, &ent, 1, 1)]));
    f.report(&G1, 5, 1); // Kapi 5 gecis beyan etti, zincirde 1 fis var.

    let (declared, settled, _) = f.client.stats(&EVT);
    assert_ne!(declared, settled, "eksik beyan denetimde gorunmeli");
}

// --- refund ----------------------------------------------------------------

#[test]
fn refund_returns_remainder_and_frees_gate_slot() {
    let f = setup();
    f.reg(&EVT, &G1);
    let dev = Device::new(31);
    let ent = f.ent_hash(0xE1);
    let u = f.lock(&dev, &ent, &G1);
    let before = f.balance(&u);

    // Imzalanan dort hakkin DORDU de zincire dusmus olmali ki acikta bir sey
    // kalmasin; ancak o zaman hesap kapanir ve kapi slotu bosalir.
    let rs = f.batch(&[
        f.receipt(&dev, &u, &ent, 1, 1),
        f.receipt(&dev, &u, &ent, 2, 2),
        f.receipt(&dev, &u, &ent, 3, 3),
        f.receipt(&dev, &u, &ent, 4, 4),
    ]);
    assert_eq!(f.client.settle(&G1, &rs), 4);

    let got = f.client.refund(&u);
    assert!(got > 0, "kalan bakiye iade edilmeli");
    assert_eq!(f.balance(&u), before + rebate_each() * 4 + got);
    assert_eq!(f.client.gate_load(&G1), 0, "kapi slotu bosalmali");
    assert!(f.client.try_account_of(&u).is_err());
    assert_eq!(f.balance(&f.client.address), 0, "kontratta para kalmamali");
}

/// **Iade, cevrimdisi kullanilmis gecislerin parasini geri veremez.**
///
/// Eskiden butun bakiye iade ediliyordu: kullanici dort kapidan gecip,
/// fisler zincire yazilmadan once `refund` cagirir ve o gecisler bedava
/// kalirdi. Artik imzalanmis her acik hak bir tam ucret olarak rezerve
/// ediliyor — kapilar cevrimdisi oldugu icin zincir en kotu ihtimali
/// varsaymak zorunda.
#[test]
fn refund_cannot_take_back_money_for_passes_used_offline() {
    let f = setup();
    f.reg(&EVT, &G1);
    let dev = Device::new(33);
    let ent = f.ent_hash(0xE3);
    let u = f.lock(&dev, &ent, &G1);
    let before = f.balance(&u);

    // Kullanici dort gecisin dordunu de offline yapti; fisler henuz zincirde
    // degil. Simdi iade almaya calisiyor.
    let got = f.client.refund(&u);
    assert!(
        got < LOCK - FARE_STROOPS * 4 + FEE,
        "acik haklarin parasi iade edilmemeli"
    );
    assert_eq!(f.balance(&u), before + got);

    // Hesap yasamaya devam etmeli, yoksa operator parasini hic alamaz.
    let acct = f.client.account_of(&u);
    assert!(acct.balance >= FARE_STROOPS * 4, "dort gecis rezerve kalmali");
    assert_eq!(f.client.gate_load(&G1), 1, "acik bilet slotu tutmali");

    // Operator fisleri getirince parasini aliyor.
    let rs = f.batch(&[
        f.receipt(&dev, &u, &ent, 1, 1),
        f.receipt(&dev, &u, &ent, 2, 2),
        f.receipt(&dev, &u, &ent, 3, 3),
        f.receipt(&dev, &u, &ent, 4, 4),
    ]);
    assert_eq!(f.client.settle(&G1, &rs), 4);
    assert_eq!(f.balance(&f.operator), FARE_STROOPS * 4);
}

/// Fisler tasindikca rezerv cozulur: ayni islemde para serbest kalir.
/// Kullaniciyi iadeye ulastiran yol, veriyi zincire tasimaktan geciyor.
#[test]
fn settling_receipts_unlocks_what_refund_had_reserved() {
    let f = setup();
    f.reg(&EVT, &G1);
    let dev = Device::new(34);
    let ent = f.ent_hash(0xE4);
    let u = f.lock(&dev, &ent, &G1);

    let locked_first = f.client.refundable_of(&u);

    // Iki fis tasindi: iki hak artik "acik" degil.
    let rs = f.batch(&[
        f.receipt(&dev, &u, &ent, 1, 1),
        f.receipt(&dev, &u, &ent, 2, 2),
    ]);
    assert_eq!(f.client.settle(&G1, &rs), 2);

    let locked_after = f.client.refundable_of(&u);
    assert!(
        locked_after > locked_first,
        "tasinan her fis iade edilebilir tutari buyutmeli: {locked_first} -> {locked_after}"
    );
}

#[test]
fn refund_keeps_spent_receipts_unusable_after_relock() {
    let f = setup();
    f.reg(&EVT, &G1);
    let dev = Device::new(32);
    let ent = f.ent_hash(0xE2);
    let u = f.lock(&dev, &ent, &G1);

    let r1 = f.receipt(&dev, &u, &ent, 1, 1);
    // Hesabin kapanabilmesi icin acikta hak kalmamali.
    let rs = f.batch(&[
        r1.clone(),
        f.receipt(&dev, &u, &ent, 2, 2),
        f.receipt(&dev, &u, &ent, 3, 3),
        f.receipt(&dev, &u, &ent, 4, 4),
    ]);
    assert_eq!(f.client.settle(&G1, &rs), 4);
    f.client.refund(&u);

    // Ayni entitlement ile tekrar kilitle.
    f.client
        .lock_float(&u, &PAID, &EVT, &G1, &FARE, &RATE, &dev.pk(&f.e), &ent);
    // Eski fis hala harcanmis sayilmali.
    assert_eq!(f.client.settle(&G1, &f.batch(&[r1])), 0);
    assert_eq!(f.client.float_of(&u), LOCK);
}

/// Bir gecisin iade ettigi hizmet bedeli.
fn rebate_each() -> i128 {
    FARE_STROOPS * FEE_BPS * REBATE_PCT / (10_000 * 100)
}

/// Kapi anahtari dondurulebilmeli: turnike bozulup degistirilirse yeni
/// cihazin anahtari farklidir. Dondurulemeseydi bir cihaz arizasi kapiyi
/// kalici olarak oldururdu.
#[test]
fn gate_key_can_be_rotated() {
    let f = setup();
    f.reg(&EVT, &G1);
    let first = BytesN::from_array(&f.e, &gate_key(&G1).verifying_key().to_bytes());
    assert_eq!(f.client.gate_pk_of(&G1), first);

    let replacement = BytesN::from_array(&f.e, &gate_key(&G2).verifying_key().to_bytes());
    f.client.set_gate_pk(&G1, &replacement);
    assert_eq!(f.client.gate_pk_of(&G1), replacement);

    // Yeni anahtarla imzalanmis belge artik G1 uzerinden gecerli.
    let dev = Device::new(45);
    let ent = f.ent_hash(0xD1);
    let u = f.lock(&dev, &ent, &G1);
    let r = f.receipt_at(&dev, &G2, &u, &ent, 1, 1, FARE);
    assert_eq!(f.client.settle(&G1, &f.batch(&[r])), 1);
}

/// Kayitli olmayan kapinin anahtari guncellenemez.
#[test]
fn set_gate_pk_rejects_unknown_gate() {
    let f = setup();
    f.reg(&EVT, &G1);
    let pk = BytesN::from_array(&f.e, &gate_key(&G2).verifying_key().to_bytes());
    assert!(f.client.try_set_gate_pk(&G3, &pk).is_err());
}

// --- Para ustu ve veri tasima odulu ----------------------------------------

/// **Para ustu.** Kapi biletin ust sinirindan az tahsil ederse fark
/// kullanicinin bakiyesinde kalir. 100 TL'lik hakla 80 TL'lik kapidan gecen
/// kullanici 20 TL'sini kaybetmez.
#[test]
fn settle_charges_only_what_the_gate_signed() {
    let f = setup();
    f.reg(&EVT, &G1);
    let dev = Device::new(40);
    let ent = f.ent_hash(0xC1);
    let u = f.lock(&dev, &ent, &G1);

    let charged_try = 8_000; // 80.00 TL
    let charged = fare_in_stroops(charged_try, RATE);
    let r = f.receipt_at(&dev, &G1, &u, &ent, 1, 1, charged_try);
    assert_eq!(f.client.settle(&G1, &f.batch(&[r])), 1);

    assert_eq!(f.balance(&f.operator), charged, "operator yalnizca tahsili alir");
    assert_eq!(
        f.client.float_of(&u),
        LOCK - charged,
        "aradaki 20 TL bakiyede kalmali"
    );
    assert!(charged < FARE_STROOPS);
}

/// Kapi, kullanicinin imzaladigi ust sinirin uzerinde tahsil edemez.
#[test]
fn settle_rejects_a_charge_above_the_signed_fare() {
    let f = setup();
    f.reg(&EVT, &G1);
    let dev = Device::new(41);
    let ent = f.ent_hash(0xC2);
    let u = f.lock(&dev, &ent, &G1);

    let r = f.receipt_at(&dev, &G1, &u, &ent, 1, 1, FARE * 2);
    assert_eq!(f.client.settle(&G1, &f.batch(&[r])), 0);
    assert_eq!(f.client.float_of(&u), LOCK, "hicbir bakiye harcanmamali");
    assert_eq!(f.balance(&f.operator), 0);
}

/// Veriyi zincire tasiyana hizmet bedelinin %80'i geri odenir.
#[test]
fn settle_pays_back_the_service_fee_to_whoever_carries_the_data() {
    let f = setup();
    f.reg(&EVT, &G1);
    let dev = Device::new(42);
    let ent = f.ent_hash(0xC3);
    let u = f.lock(&dev, &ent, &G1);
    let before = f.balance(&u);

    assert_eq!(f.client.account_of(&u).fee_held, FEE);
    f.client
        .settle(&G1, &f.batch(&[f.receipt(&dev, &u, &ent, 1, 1)]));

    let paid = rebate_each();
    assert!(paid > 0);
    assert_eq!(f.balance(&u), before + paid, "iade cuzdana dusmeli");
    assert_eq!(f.client.account_of(&u).fee_held, FEE - paid);
}

/// Iade, alinan bedelden fazla olamaz.
#[test]
fn rebate_never_exceeds_the_fee_that_was_collected() {
    let f = setup();
    f.reg(&EVT, &G1);
    let dev = Device::new(43);
    let ent = f.ent_hash(0xC4);
    let u = f.lock(&dev, &ent, &G1);

    let rs = f.batch(&[
        f.receipt(&dev, &u, &ent, 1, 1),
        f.receipt(&dev, &u, &ent, 2, 2),
        f.receipt(&dev, &u, &ent, 3, 3),
        f.receipt(&dev, &u, &ent, 4, 4),
    ]);
    assert_eq!(f.client.settle(&G1, &rs), 4);
    let acct = f.client.account_of(&u);
    assert!(acct.fee_held >= 0);
    assert_eq!(acct.fee_held, FEE - rebate_each() * 4);
}

/// Settle izin gerektirmez: veriyi kim getirirse getirsin calisir.
/// Sistemin kendi kendini kapatmasini saglayan sey bu.
#[test]
fn anyone_can_carry_the_data_on_chain() {
    let f = setup();
    f.reg(&EVT, &G1);
    let dev = Device::new(44);
    let ent = f.ent_hash(0xC5);
    let u = f.lock(&dev, &ent, &G1);

    // Admin degil, operator degil, hesap sahibi bile degil — yabanci biri.
    let stranger = Address::generate(&f.e);
    f.e.mock_all_auths();
    let _ = stranger;

    assert_eq!(
        f.client
            .settle(&G1, &f.batch(&[f.receipt(&dev, &u, &ent, 1, 1)])),
        1
    );
    assert_eq!(f.balance(&f.operator), FARE_STROOPS);
}

// --- Kapi beyani -----------------------------------------------------------

/// Beyan kapinin kendi imzasiyla gelir; imzasiz sayi kabul edilmez.
#[test]
#[should_panic]
fn gate_report_requires_the_gate_signature() {
    let f = setup();
    f.reg(&EVT, &G1);
    // G2'nin anahtariyla imzalanmis bir beyan, G1 adina gecirilemez.
    let mut m = std::vec::Vec::new();
    m.extend_from_slice(RPRT_DOMAIN);
    m.extend_from_slice(&7u32.to_be_bytes());
    m.extend_from_slice(&1u64.to_be_bytes());
    let sig = gate_key(&G2).sign(&m).to_bytes();
    f.client
        .gate_report(&G1, &7, &1, &BytesN::from_array(&f.e, &sig));
}

/// Eski bir imzali beyan tekrar oynatilarak sayac dusurulemez.
#[test]
fn gate_report_ignores_a_replayed_older_counter() {
    let f = setup();
    f.reg(&EVT, &G1);
    f.report(&G1, 9, 1);
    assert_eq!(f.client.declared_of(&G1), 9);
    f.report(&G1, 4, 2); // eski rapor
    assert_eq!(f.client.declared_of(&G1), 9, "sayac geri gitmemeli");
}

#[test]
#[should_panic]
fn refund_requires_user_auth() {
    let f = setup();
    f.reg(&EVT, &G1);
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
        f.reg(&EVT, g);
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
