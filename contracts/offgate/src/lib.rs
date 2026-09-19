#![no_std]
//! OffGate — internetsiz gecis ve odeme altyapisi.
//!
//! Akis: kullanici USDC'sini kontrata kilitler (`lock_float`) ve bir kapiya
//! atanir. Kapida internet yokken imzali fis uretir; kapi fisi offline dogrular.
//! Internet gelince fisler `settle` ile zincire yazilir ve para operatore gecer.
//!
//! P3 kapsami: kurulum, kapi kaydi, `lock_float`, kapi atamasi, okuma fonksiyonlari.
//! `settle` / `refund` P4'te gelecek.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, BytesN,
    Env, Symbol, Vec,
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

// --- Veri modeli -----------------------------------------------------------

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    // instance — kurulum sabitleri
    Admin,
    Token,
    OperatorPk,
    // persistent — isleyen veri
    /// Bir etkinlige kayitli kapilarin listesi.
    Gates(Symbol),
    /// Kapinin uzerindeki kullanici yuku (yuk dengeli atama icin).
    GateLoad(Symbol),
    /// Kullanicinin kilitli bakiyesi ve bilet parametreleri.
    Acct(Address),
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
    /// Atanan kapi. Cifte harcama bu tek kapiya baglanarak onleniyor.
    pub gate: Symbol,
    /// Gecis ucreti, kurus (10000 = 100.00 TL).
    pub fare_try: i128,
    /// SEP-38'den gelen kilitli kur, TRY/USDC * 10^7.
    pub rate: i128,
    /// Fisleri imzalayacak cihaz anahtari (karar K-1).
    /// Cuzdanin ana anahtari telefonun offline tarafina hic inmez.
    pub device_pk: BytesN<32>,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    /// Etkinlige kayitli kapi yok, atama yapilamaz.
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

/// Kullanici bakiyesini kilitledi ve bir kapiya atandi.
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

#[contractimpl]
impl OffGate {
    // --- Kurulum -----------------------------------------------------------

    /// Tek seferlik kurulum. `operator_pk`, entitlement imzalarinin dogrulandigi
    /// ham Ed25519 acik anahtardir (ESP32 firmware'ine de gomulur).
    pub fn init(
        e: Env,
        admin: Address,
        usdc_token: Address,
        operator_pk: BytesN<32>,
    ) -> Result<(), Error> {
        let store = e.storage().instance();
        if store.has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        store.set(&DataKey::Admin, &admin);
        store.set(&DataKey::Token, &usdc_token);
        store.set(&DataKey::OperatorPk, &operator_pk);
        Ok(())
    }

    /// Etkinlige bir kapi ekler. Yalnizca admin.
    pub fn register_gate(e: Env, event: Symbol, gate: Symbol) -> Result<(), Error> {
        let admin = cfg_address(&e, DataKey::Admin)?;
        admin.require_auth();

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

    /// Kullanicinin USDC'sini kontrata kilitler ve ona bir kapi atar.
    ///
    /// `require_auth` zorunlu: para yalnizca sahibinin imzasiyla hareket eder.
    /// Donen deger, kullanicinin gecis yapacagi kapidir.
    pub fn lock_float(
        e: Env,
        user: Address,
        amount: i128,
        event: Symbol,
        fare_try: i128,
        rate: i128,
        device_pk: BytesN<32>,
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

        // Kapi atamasi kilitten once yapilir: atama basarisizsa para hic hareket etmez.
        let gate = Self::assign_gate(e.clone(), event.clone())?;

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
        };
        e.storage().persistent().set(&acct_key, &acct);
        bump(&e, &acct_key);

        let load_key = DataKey::GateLoad(gate.clone());
        let load: u32 = e.storage().persistent().get(&load_key).unwrap_or(0);
        e.storage().persistent().set(&load_key, &(load + 1));
        bump(&e, &load_key);

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

    /// Etkinlikteki en az yuklu kapiyi secer. Esitlikte kayit sirasinda ilki.
    pub fn assign_gate(e: Env, event: Symbol) -> Result<Symbol, Error> {
        let gates: Vec<Symbol> = e
            .storage()
            .persistent()
            .get(&DataKey::Gates(event))
            .ok_or(Error::NoGates)?;
        if gates.is_empty() {
            return Err(Error::NoGates);
        }

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

    pub fn gate_load(e: Env, gate: Symbol) -> u32 {
        e.storage().persistent().get(&DataKey::GateLoad(gate)).unwrap_or(0)
    }

    pub fn gates_of(e: Env, event: Symbol) -> Vec<Symbol> {
        e.storage()
            .persistent()
            .get(&DataKey::Gates(event))
            .unwrap_or_else(|| Vec::new(&e))
    }

    pub fn admin(e: Env) -> Result<Address, Error> {
        cfg_address(&e, DataKey::Admin)
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
}

mod test;
