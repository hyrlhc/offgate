#![no_std]
//! OffGate — internetsiz gecis ve odeme altyapisi.
//!
//! Akis: kullanici USDC'sini kontrata kilitler (`lock_float`) ve bir kapiya
//! baglanir. Kapida internet yokken cihaz anahtariyla imzali fis uretir; kapi
//! fisi offline dogrular. Internet gelince fisler `settle` ile zincire yazilir
//! ve para operatore gecer. Harcanmayan bakiye `refund` ile geri alinir.
//!
//! Cifte harcama, kullaniciyi tek kapiya baglayarak cozuluyor: harcandigi yer
//! ile hatirlayan yer ayni cihaz.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Bytes,
    BytesN, Env, Symbol, Vec,
};

// --- Sabitler --------------------------------------------------------------

/// USDC'nin ondalik basamak sayisi (1 USDC = 10^7 stroop).
const USDC_SCALE: i128 = 10_000_000;
/// SEP-38 kurunun olcegi: TRY/USDC degeri 10^7 ile carpilarak saklanir.
const RATE_SCALE: i128 = 10_000_000;
/// TL'nin kurus olcegi.
const TRY_SCALE: i128 = 100;

/// `persistent` verinin arsive kalkmamasi icin TTL uzatma esikleri.
const TTL_THRESHOLD: u32 = 100_000;
const TTL_EXTEND: u32 = 500_000;

/// Kullanicinin sectigi kapi, en az yuklu kapidan en fazla bu kadar yuklu
/// olabilir. Yuk dengesini zincirde zorunlu kilar, ayni anda gelen
/// isteklerdeki yarisa da tolerans birakir.
const GATE_LOAD_TOLERANCE: u32 = 2;

/// Fis imzasinin alan ayirici oneki (karar K-4).
/// Kanonik mesaj, tam olarak 67 bayttir:
///   "OFFGATE-RCPT-v1" (15) || ent_hash (32) || seq (4, BE)
///   || fare_try (8, BE) || ts (8, BE)
/// Ayni baytlar Rust, JavaScript ve ESP32 tarafinda birebir uretilir;
/// dogrulama tasima katmanindan bagimsizdir (karar K-8).
const RCPT_DOMAIN: &[u8; 15] = b"OFFGATE-RCPT-v1";
const RCPT_MSG_LEN: u32 = 67;

// --- Veri modeli -----------------------------------------------------------

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    // instance — kurulum sabitleri
    Admin,
    Operator,
    Token,
    OperatorPk,
    // persistent — isleyen veri
    /// Bir etkinlige kayitli kapilarin listesi.
    Gates(Symbol),
    /// Kapinin uzerindeki kullanici yuku (yuk dengeli atama icin).
    GateLoad(Symbol),
    /// Kullanicinin kilitli bakiyesi ve bilet parametreleri.
    Acct(Address),
    /// Harcanmis fis: (entitlement hash, sira no). Tekrar saldirisini onler.
    Spent(BytesN<32>, u32),
    /// Kapinin kendi beyan ettigi gecis sayisi (denetim icin).
    Declared(Symbol),
    /// Kapidan zincire dusen fis sayisi.
    Settled(Symbol),
    /// Etkinligin toplam hasilati, USDC stroop.
    Revenue(Symbol),
}

/// Kullanicinin kilitli bakiyesi ve biletinin degismeyen parametreleri.
///
/// `rate` ve `fare_try` birlikte biletin TL fiyatini sabitler: kur sonradan
/// oynasa da kullanicinin gecis basina odedigi TL degismez.
#[derive(Clone)]
#[contracttype]
pub struct Acct {
    /// Kalan kilitli bakiye, USDC stroop (10^7).
    pub balance: i128,
    /// Baslangicta kilitlenen tutar, USDC stroop.
    pub locked: i128,
    pub event: Symbol,
    /// Bagli oldugu kapi. Cifte harcama bu tek kapiya baglanarak onleniyor.
    pub gate: Symbol,
    /// Gecis ucreti, kurus (10000 = 100.00 TL).
    pub fare_try: i128,
    /// SEP-38'den gelen kilitli kur, TRY/USDC * 10^7.
    pub rate: i128,
    /// Fisleri imzalayan cihaz anahtari (karar K-1).
    /// Cuzdanin ana anahtari telefonun offline tarafina hic inmez.
    pub device_pk: BytesN<32>,
    /// Operatorun imzaladigi entitlement belgesinin sha256'si.
    /// Fisler bu hash uzerinden bu bilete baglanir.
    pub ent_hash: BytesN<32>,
}

/// Kapinin topladigi, cihaz anahtariyla imzalanmis gecis fisi.
///
/// `user` ve `sig` disindaki alanlar imzali mesajin icindedir; `user` imzali
/// degildir ama degistirilirse `ent_hash` o hesabinkiyle tutmaz ve fis reddedilir.
#[derive(Clone)]
#[contracttype]
pub struct Receipt {
    pub ent_hash: BytesN<32>,
    pub user: Address,
    pub seq: u32,
    pub fare_try: i128,
    pub ts: u64,
    pub sig: BytesN<64>,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    /// Etkinlige kayitli kapi yok.
    NoGates = 3,
    /// Kapi bu etkinlikte zaten kayitli.
    GateExists = 4,
    /// Tutar, ucret veya kur sifir ya da negatif.
    InvalidAmount = 5,
    /// Kilitlenen tutar bir gecise bile yetmiyor.
    AmountBelowFare = 6,
    /// Kullanicinin acik bir kilidi zaten var.
    AlreadyLocked = 7,
    NoAccount = 8,
    /// Secilen kapi bu etkinlige kayitli degil.
    UnknownGate = 9,
    /// Secilen kapi, en az yuklu kapidan tolerans disi daha yuklu.
    GateTooLoaded = 10,
}

// --- Olaylar ---------------------------------------------------------------
// Frontend'in denetim ekrani ve canli gostergesi bu olaylari dinler.

/// Etkinlige yeni bir kapi kaydedildi.
#[contractevent]
#[derive(Clone)]
pub struct GateRegistered {
    #[topic]
    pub event: Symbol,
    pub gate: Symbol,
}

/// Kullanici bakiyesini kilitledi ve bir kapiya baglandi.
#[contractevent]
#[derive(Clone)]
pub struct FloatLocked {
    #[topic]
    pub user: Address,
    #[topic]
    pub event: Symbol,
    pub gate: Symbol,
    pub amount: i128,
    pub fare_try: i128,
    pub rate: i128,
}

/// Offline toplanan fisler zincire yazildi, para operatore gecti.
#[contractevent]
#[derive(Clone)]
pub struct Settled {
    #[topic]
    pub gate: Symbol,
    pub accepted: u32,
    pub submitted: u32,
    pub amount: i128,
}

/// Kapinin kendi beyani (denetim icin).
#[contractevent]
#[derive(Clone)]
pub struct GateReported {
    #[topic]
    pub gate: Symbol,
    pub counter: u32,
}

/// Harcanmayan bakiye kullaniciya iade edildi.
#[contractevent]
#[derive(Clone)]
pub struct Refunded {
    #[topic]
    pub user: Address,
    pub amount: i128,
}

#[contract]
pub struct OffGate;

// --- Yardimcilar -----------------------------------------------------------

fn cfg_address(e: &Env, key: DataKey) -> Result<Address, Error> {
    e.storage().instance().get(&key).ok_or(Error::NotInitialized)
}

fn bump(e: &Env, key: &DataKey) {
    e.storage().persistent().extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND);
}

/// Bir gecisin USDC karsiligi.
///
/// `fare_try` kurus, `rate` TRY/USDC * 10^7 olduguna gore:
///   USDC = (fare_try / 100) / (rate / 10^7)
/// stroop cinsinden:
///   stroop = fare_try * 10^7 * 10^7 / (100 * rate)
pub fn fare_in_stroops(fare_try: i128, rate: i128) -> i128 {
    fare_try * USDC_SCALE * RATE_SCALE / (TRY_SCALE * rate)
}

/// Fisin imzalanan kanonik baytlarini uretir (67 bayt, karar K-4).
/// Bu fonksiyonun ciktisi JavaScript ve ESP32 tarafiyla birebir ayni olmalidir.
fn receipt_message(e: &Env, ent_hash: &BytesN<32>, seq: u32, fare_try: i128, ts: u64) -> Bytes {
    let mut msg = Bytes::from_array(e, RCPT_DOMAIN);
    msg.append(&Bytes::from(ent_hash.clone()));
    msg.extend_from_array(&seq.to_be_bytes());
    msg.extend_from_array(&(fare_try as u64).to_be_bytes());
    msg.extend_from_array(&ts.to_be_bytes());
    debug_assert_eq!(msg.len(), RCPT_MSG_LEN);
    msg
}

#[contractimpl]
impl OffGate {
    // --- Kurulum -----------------------------------------------------------

    /// Tek seferlik kurulum.
    ///
    /// `operator` hasilatin gececegi adres, `operator_pk` ise entitlement
    /// belgelerini imzalayan ham Ed25519 acik anahtardir (ESP32'ye gomulur).
    pub fn init(
        e: Env,
        admin: Address,
        operator: Address,
        usdc_token: Address,
        operator_pk: BytesN<32>,
    ) -> Result<(), Error> {
        let store = e.storage().instance();
        if store.has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        store.set(&DataKey::Admin, &admin);
        store.set(&DataKey::Operator, &operator);
        store.set(&DataKey::Token, &usdc_token);
        store.set(&DataKey::OperatorPk, &operator_pk);
        Ok(())
    }

    /// Etkinlige bir kapi ekler. Yalnizca admin.
    pub fn register_gate(e: Env, event: Symbol, gate: Symbol) -> Result<(), Error> {
        cfg_address(&e, DataKey::Admin)?.require_auth();

        let gates_key = DataKey::Gates(event.clone());
        let mut gates: Vec<Symbol> = e
            .storage()
            .persistent()
            .get(&gates_key)
            .unwrap_or_else(|| Vec::new(&e));

        if gates.iter().any(|g| g == gate) {
            return Err(Error::GateExists);
        }
        gates.push_back(gate.clone());
        e.storage().persistent().set(&gates_key, &gates);
        bump(&e, &gates_key);

        let load_key = DataKey::GateLoad(gate.clone());
        e.storage().persistent().set(&load_key, &0u32);
        bump(&e, &load_key);

        GateRegistered { event, gate }.publish(&e);
        Ok(())
    }

    // --- Ana akis ----------------------------------------------------------

    /// Kullanicinin USDC'sini kontrata kilitler ve onu bir kapiya baglar.
    ///
    /// `require_auth` zorunlu: para yalnizca sahibinin imzasiyla hareket eder.
    ///
    /// `gate`, cagirmadan once `assign_gate` ile secilir. Kapi entitlement
    /// belgesinin icinde oldugu ve `ent_hash` o belgenin ozeti oldugu icin,
    /// kapi secimi kilitten once bilinmek zorundadir. Sozlesme secimi yine de
    /// denetler: kapi etkinlige kayitli olmali ve `GATE_LOAD_TOLERANCE`
    /// sinirini asmamalidir.
    #[allow(clippy::too_many_arguments)]
    pub fn lock_float(
        e: Env,
        user: Address,
        amount: i128,
        event: Symbol,
        gate: Symbol,
        fare_try: i128,
        rate: i128,
        device_pk: BytesN<32>,
        ent_hash: BytesN<32>,
    ) -> Result<Symbol, Error> {
        user.require_auth();

        if amount <= 0 || fare_try <= 0 || rate <= 0 {
            return Err(Error::InvalidAmount);
        }
        let acct_key = DataKey::Acct(user.clone());
        if e.storage().persistent().has(&acct_key) {
            return Err(Error::AlreadyLocked);
        }
        if amount < fare_in_stroops(fare_try, rate) {
            return Err(Error::AmountBelowFare);
        }

        // Kapi denetimi para hareketinden once: reddedilirse USDC hic kimildamaz.
        Self::check_gate(&e, &event, &gate)?;

        let token_addr = cfg_address(&e, DataKey::Token)?;
        token::Client::new(&e, &token_addr).transfer(
            &user,
            &e.current_contract_address(),
            &amount,
        );

        let acct = Acct {
            balance: amount,
            locked: amount,
            event: event.clone(),
            gate: gate.clone(),
            fare_try,
            rate,
            device_pk,
            ent_hash,
        };
        e.storage().persistent().set(&acct_key, &acct);
        bump(&e, &acct_key);

        Self::add_load(&e, &gate, 1);

        FloatLocked {
            user,
            event,
            gate: gate.clone(),
            amount,
            fare_try,
            rate,
        }
        .publish(&e);
        Ok(gate)
    }

    /// Offline toplanan fisleri zincire yazar ve hasilati operatore aktarir.
    ///
    /// Her fis icin sirayla: bu kapiya mi ait, bilete bagli mi, daha once
    /// harcanmis mi, imzasi gecerli mi, bakiye yetiyor mu.
    ///
    /// **Idempotent:** ayni fis ikinci kez gonderilirse sessizce atlanir, batch
    /// dusmez. Gorevli ayni senkronizasyonu iki kez calistirabilir.
    ///
    /// **Gecersiz imza batch'i durdurur.** `ed25519_verify` basarisizlikta panik
    /// atar, deger dondurmez. Kapi zaten her fisi kabul anindan once dogruladigi
    /// icin normal akista sahte fis settle'a hic ulasmaz.
    pub fn settle(e: Env, gate: Symbol, receipts: Vec<Receipt>) -> Result<u32, Error> {
        cfg_address(&e, DataKey::Admin)?.require_auth();

        let submitted = receipts.len();
        let mut accepted: u32 = 0;
        let mut total: i128 = 0;

        for r in receipts.iter() {
            let acct_key = DataKey::Acct(r.user.clone());
            let Some(mut acct) = e.storage().persistent().get::<_, Acct>(&acct_key) else {
                continue; // Hesap yok ya da iade edilmis.
            };
            if acct.gate != gate || acct.ent_hash != r.ent_hash || acct.fare_try != r.fare_try {
                continue; // Fis bu kapiya veya bu bilete ait degil.
            }

            let spent_key = DataKey::Spent(r.ent_hash.clone(), r.seq);
            if e.storage().persistent().has(&spent_key) {
                continue; // Zaten harcanmis — tekrar saldirisi ya da mukerrer gonderim.
            }

            let fare = fare_in_stroops(acct.fare_try, acct.rate);
            if acct.balance < fare {
                continue; // Bakiye tukenmis.
            }

            // Imza: gecersizse panik atar ve tum batch geri alinir.
            e.crypto().ed25519_verify(
                &acct.device_pk,
                &receipt_message(&e, &r.ent_hash, r.seq, r.fare_try, r.ts),
                &r.sig,
            );

            e.storage().persistent().set(&spent_key, &true);
            bump(&e, &spent_key);

            acct.balance -= fare;
            e.storage().persistent().set(&acct_key, &acct);
            bump(&e, &acct_key);

            // Etkinlik hasilati denetim ekrani icin biriktiriliyor.
            let rev_key = DataKey::Revenue(acct.event.clone());
            let prev_rev: i128 = e.storage().persistent().get(&rev_key).unwrap_or(0);
            e.storage().persistent().set(&rev_key, &(prev_rev + fare));
            bump(&e, &rev_key);

            total += fare;
            accepted += 1;
        }

        if total > 0 {
            let token_addr = cfg_address(&e, DataKey::Token)?;
            let operator = cfg_address(&e, DataKey::Operator)?;
            token::Client::new(&e, &token_addr).transfer(
                &e.current_contract_address(),
                &operator,
                &total,
            );

            let settled_key = DataKey::Settled(gate.clone());
            let prev: u32 = e.storage().persistent().get(&settled_key).unwrap_or(0);
            e.storage().persistent().set(&settled_key, &(prev + accepted));
            bump(&e, &settled_key);
        }

        Settled {
            gate,
            accepted,
            submitted,
            amount: total,
        }
        .publish(&e);
        Ok(accepted)
    }

    /// Kapinin kendi gecis sayaci. Zincirdeki fis sayisiyla karsilastirilarak
    /// operatorun eksik hasilat beyan etmedigi denetlenir.
    pub fn gate_report(e: Env, gate: Symbol, counter: u32) -> Result<(), Error> {
        cfg_address(&e, DataKey::Admin)?.require_auth();
        let key = DataKey::Declared(gate.clone());
        e.storage().persistent().set(&key, &counter);
        bump(&e, &key);
        GateReported { gate, counter }.publish(&e);
        Ok(())
    }

    /// Etkinlik bitince harcanmayan bakiyeyi kullaniciya geri verir.
    pub fn refund(e: Env, user: Address) -> Result<i128, Error> {
        user.require_auth();

        let acct_key = DataKey::Acct(user.clone());
        let acct: Acct = e
            .storage()
            .persistent()
            .get(&acct_key)
            .ok_or(Error::NoAccount)?;

        let amount = acct.balance;
        if amount > 0 {
            let token_addr = cfg_address(&e, DataKey::Token)?;
            token::Client::new(&e, &token_addr).transfer(
                &e.current_contract_address(),
                &user,
                &amount,
            );
        }

        // Kayit siliniyor; harcanmis fisler `Spent` altinda kaliyor, boylece
        // eski fisler yeni bir kilitte tekrar kullanilamaz.
        e.storage().persistent().remove(&acct_key);
        Self::add_load(&e, &acct.gate, -1);

        Refunded { user, amount }.publish(&e);
        Ok(amount)
    }

    // --- Kapi atamasi ------------------------------------------------------

    /// Etkinlikteki en az yuklu kapiyi secer. Esitlikte kayit sirasinda ilki.
    /// Frontend bunu `lock_float`tan once cagirir.
    pub fn assign_gate(e: Env, event: Symbol) -> Result<Symbol, Error> {
        let gates = Self::gates_or_err(&e, &event)?;
        let mut best = gates.get_unchecked(0);
        let mut best_load = Self::gate_load(e.clone(), best.clone());
        for gate in gates.iter().skip(1) {
            let load = Self::gate_load(e.clone(), gate.clone());
            if load < best_load {
                best_load = load;
                best = gate;
            }
        }
        Ok(best)
    }

    // --- Okuma -------------------------------------------------------------

    pub fn float_of(e: Env, user: Address) -> i128 {
        e.storage()
            .persistent()
            .get::<_, Acct>(&DataKey::Acct(user))
            .map(|a| a.balance)
            .unwrap_or(0)
    }

    pub fn account_of(e: Env, user: Address) -> Result<Acct, Error> {
        e.storage()
            .persistent()
            .get(&DataKey::Acct(user))
            .ok_or(Error::NoAccount)
    }

    /// Kullanicinin kalan bakiyesiyle kac gecis daha yapabilecegi.
    pub fn uses_left(e: Env, user: Address) -> Result<u32, Error> {
        let a = Self::account_of(e, user)?;
        Ok((a.balance / fare_in_stroops(a.fare_try, a.rate)) as u32)
    }

    /// Bir fisin daha once harcanip harcanmadigi.
    pub fn is_spent(e: Env, ent_hash: BytesN<32>, seq: u32) -> bool {
        e.storage().persistent().has(&DataKey::Spent(ent_hash, seq))
    }

    pub fn gate_load(e: Env, gate: Symbol) -> u32 {
        e.storage().persistent().get(&DataKey::GateLoad(gate)).unwrap_or(0)
    }

    pub fn gates_of(e: Env, event: Symbol) -> Vec<Symbol> {
        e.storage()
            .persistent()
            .get(&DataKey::Gates(event))
            .unwrap_or_else(|| Vec::new(&e))
    }

    /// Denetim ozeti: (kapilarin beyani, zincire dusen fis, toplam hasilat).
    /// Ilk iki sayi tutmuyorsa operator eksik beyan etmis demektir.
    pub fn stats(e: Env, event: Symbol) -> (u32, u32, i128) {
        let gates = Self::gates_of(e.clone(), event.clone());
        let mut declared = 0u32;
        let mut settled = 0u32;
        for gate in gates.iter() {
            declared += e
                .storage()
                .persistent()
                .get::<_, u32>(&DataKey::Declared(gate.clone()))
                .unwrap_or(0);
            settled += e
                .storage()
                .persistent()
                .get::<_, u32>(&DataKey::Settled(gate))
                .unwrap_or(0);
        }
        let revenue = e
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::Revenue(event))
            .unwrap_or(0);
        (declared, settled, revenue)
    }

    pub fn declared_of(e: Env, gate: Symbol) -> u32 {
        e.storage().persistent().get(&DataKey::Declared(gate)).unwrap_or(0)
    }

    pub fn settled_of(e: Env, gate: Symbol) -> u32 {
        e.storage().persistent().get(&DataKey::Settled(gate)).unwrap_or(0)
    }

    pub fn admin(e: Env) -> Result<Address, Error> {
        cfg_address(&e, DataKey::Admin)
    }

    pub fn operator(e: Env) -> Result<Address, Error> {
        cfg_address(&e, DataKey::Operator)
    }

    pub fn token(e: Env) -> Result<Address, Error> {
        cfg_address(&e, DataKey::Token)
    }

    pub fn operator_pk(e: Env) -> Result<BytesN<32>, Error> {
        e.storage()
            .instance()
            .get(&DataKey::OperatorPk)
            .ok_or(Error::NotInitialized)
    }

    /// Kanonik mesaj formati surumu (karar K-4). Firmware ve web ile eslesmeli.
    pub fn version(_e: Env) -> u32 {
        1
    }

    // --- Ic yardimcilar ----------------------------------------------------

    fn gates_or_err(e: &Env, event: &Symbol) -> Result<Vec<Symbol>, Error> {
        let gates: Vec<Symbol> = e
            .storage()
            .persistent()
            .get(&DataKey::Gates(event.clone()))
            .ok_or(Error::NoGates)?;
        if gates.is_empty() {
            return Err(Error::NoGates);
        }
        Ok(gates)
    }

    /// Kapi bu etkinlige kayitli mi ve yuk dengesi toleransi iciinde mi.
    fn check_gate(e: &Env, event: &Symbol, gate: &Symbol) -> Result<(), Error> {
        let gates = Self::gates_or_err(e, event)?;
        if !gates.iter().any(|g| &g == gate) {
            return Err(Error::UnknownGate);
        }
        let mut min_load = u32::MAX;
        for g in gates.iter() {
            let load = Self::gate_load(e.clone(), g);
            if load < min_load {
                min_load = load;
            }
        }
        if Self::gate_load(e.clone(), gate.clone()) > min_load + GATE_LOAD_TOLERANCE {
            return Err(Error::GateTooLoaded);
        }
        Ok(())
    }

    fn add_load(e: &Env, gate: &Symbol, delta: i32) {
        let key = DataKey::GateLoad(gate.clone());
        let load: u32 = e.storage().persistent().get(&key).unwrap_or(0);
        let next = if delta < 0 {
            load.saturating_sub((-delta) as u32)
        } else {
            load + delta as u32
        };
        e.storage().persistent().set(&key, &next);
        bump(e, &key);
    }
}

mod test;
