#![cfg(test)]

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events},
    token::StellarAssetClient,
    Address, BytesN, Env, Symbol,
};

/// 100.00 TL gecis ucreti, kurus cinsinden.
const FARE: i128 = 10_000;
/// 1 USDC = 48.785078 TRY, 10^7 olcekli.
const RATE: i128 = 487_850_780;

struct Fix<'a> {
    e: Env,
    client: OffGateClient<'a>,
    token: Address,
    admin: Address,
}

fn setup() -> Fix<'static> {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let sac = e.register_stellar_asset_contract_v2(admin.clone());
    let token = sac.address();

    let id = e.register(OffGate, ());
    let client = OffGateClient::new(&e, &id);
    client.init(&admin, &token, &BytesN::from_array(&e, &[7u8; 32]));

    Fix { e, client, token, admin }
}

impl Fix<'_> {
    /// Fonlanmis bir kullanici uretir.
    fn user(&self, usdc: i128) -> Address {
        let u = Address::generate(&self.e);
        StellarAssetClient::new(&self.e, &self.token).mint(&u, &usdc);
        u
    }
    fn device(&self, seed: u8) -> BytesN<32> {
        BytesN::from_array(&self.e, &[seed; 32])
    }
    fn balance(&self, who: &Address) -> i128 {
        soroban_sdk::token::Client::new(&self.e, &self.token).balance(who)
    }
}

// --- Kurulum ---------------------------------------------------------------

#[test]
fn init_stores_config_and_rejects_second_call() {
    let f = setup();
    assert_eq!(f.client.admin(), f.admin);
    assert_eq!(f.client.token(), f.token);
    assert_eq!(f.client.version(), 1);
    assert!(f
        .client
        .try_init(&f.admin, &f.token, &f.device(1))
        .is_err());
}

// --- Kapi kaydi ------------------------------------------------------------

#[test]
fn register_gate_adds_once_and_rejects_duplicate() {
    let f = setup();
    let ev = symbol_short!("EVT1");

    f.client.register_gate(&ev, &symbol_short!("M307"));
    f.client.register_gate(&ev, &symbol_short!("M308"));
    assert_eq!(f.client.gates_of(&ev).len(), 2);
    assert_eq!(f.client.gate_load(&symbol_short!("M307")), 0);

    assert!(f
        .client
        .try_register_gate(&ev, &symbol_short!("M307"))
        .is_err());
    assert_eq!(f.client.gates_of(&ev).len(), 2);
}

#[test]
fn lock_without_gates_fails_and_moves_no_money() {
    let f = setup();
    let u = f.user(50 * 10_000_000);
    let before = f.balance(&u);

    assert!(f
        .client
        .try_lock_float(
            &u,
            &(10 * 10_000_000),
            &symbol_short!("EVT1"),
            &FARE,
            &RATE,
            &f.device(9)
        )
        .is_err());
    assert_eq!(f.balance(&u), before, "atama basarisizsa para hic hareket etmemeli");
}

// --- lock_float ------------------------------------------------------------

#[test]
fn lock_float_moves_usdc_and_assigns_gate() {
    let f = setup();
    let ev = symbol_short!("EVT1");
    let gate = symbol_short!("M307");
    f.client.register_gate(&ev, &gate);

    let u = f.user(50 * 10_000_000);
    let amount = 102_000_000i128; // ~10.2 USDC
    let assigned = f.client.lock_float(&u, &amount, &ev, &FARE, &RATE, &f.device(3));

    // `events().all()` yalnizca SON kontrat cagrisinin olaylarini tutar,
    // bu yuzden okuma cagrilarindan once kontrol ediliyor.
    let emitted = f.e.events().all();
    assert!(
        !emitted.events().is_empty(),
        "lock_float FloatLocked olayini yayinlamali"
    );

    assert_eq!(assigned, gate);
    assert_eq!(f.client.float_of(&u), amount);
    assert_eq!(f.client.gate_load(&gate), 1);
    assert_eq!(f.balance(&u), 50 * 10_000_000 - amount);
    assert_eq!(f.balance(&f.client.address), amount, "USDC kontrata gecmeli");

    let acct = f.client.account_of(&u);
    assert_eq!(acct.fare_try, FARE);
    assert_eq!(acct.rate, RATE);
    assert_eq!(acct.device_pk, f.device(3));
    assert_eq!(acct.gate, gate);

    // 100 TL ucret, 48.785078 kur -> gecis basina ~2.0498 USDC -> 10.2 USDC ile 4 gecis
    assert_eq!(f.client.uses_left(&u), 4);

}

#[test]
fn lock_float_rejects_amount_below_one_fare() {
    let f = setup();
    let ev = symbol_short!("EVT1");
    f.client.register_gate(&ev, &symbol_short!("M307"));

    let u = f.user(50 * 10_000_000);
    let before = f.balance(&u);
    // Bir gecis ~2.0498 USDC; 1 USDC yetmez.
    assert!(f
        .client
        .try_lock_float(&u, &10_000_000, &ev, &FARE, &RATE, &f.device(4))
        .is_err());
    assert_eq!(f.balance(&u), before);
}

#[test]
fn lock_float_rejects_second_lock_for_same_user() {
    let f = setup();
    let ev = symbol_short!("EVT1");
    f.client.register_gate(&ev, &symbol_short!("M307"));

    let u = f.user(50 * 10_000_000);
    f.client.lock_float(&u, &102_000_000, &ev, &FARE, &RATE, &f.device(5));
    assert!(f
        .client
        .try_lock_float(&u, &102_000_000, &ev, &FARE, &RATE, &f.device(5))
        .is_err());
    assert_eq!(f.client.gate_load(&symbol_short!("M307")), 1);
}

#[test]
fn lock_float_rejects_nonpositive_values() {
    let f = setup();
    let ev = symbol_short!("EVT1");
    f.client.register_gate(&ev, &symbol_short!("M307"));
    let u = f.user(50 * 10_000_000);
    let d = f.device(6);

    assert!(f.client.try_lock_float(&u, &0, &ev, &FARE, &RATE, &d).is_err());
    assert!(f.client.try_lock_float(&u, &102_000_000, &ev, &0, &RATE, &d).is_err());
    assert!(f.client.try_lock_float(&u, &102_000_000, &ev, &FARE, &0, &d).is_err());
}

/// Para hareketi olan fonksiyon imzasiz cagrilamaz.
#[test]
#[should_panic]
fn lock_float_requires_user_auth() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let sac = e.register_stellar_asset_contract_v2(admin.clone());
    let id = e.register(OffGate, ());
    let client = OffGateClient::new(&e, &id);
    client.init(&admin, &sac.address(), &BytesN::from_array(&e, &[7u8; 32]));
    let ev = symbol_short!("EVT1");
    client.register_gate(&ev, &symbol_short!("M307"));

    let u = Address::generate(&e);
    StellarAssetClient::new(&e, &sac.address()).mint(&u, &(50 * 10_000_000));

    // Yetkilendirmeyi kaldir: artik imzasiz cagri panik atmali.
    e.set_auths(&[]);
    client.lock_float(
        &u,
        &102_000_000,
        &ev,
        &FARE,
        &RATE,
        &BytesN::from_array(&e, &[8u8; 32]),
    );
}

// --- Kapi atamasi ----------------------------------------------------------

#[test]
fn gate_assignment_spreads_load_evenly() {
    let f = setup();
    let ev = symbol_short!("EVT1");
    let gates = [symbol_short!("M307"), symbol_short!("M308"), symbol_short!("M309")];
    for g in &gates {
        f.client.register_gate(&ev, g);
    }

    for i in 0..6u8 {
        let u = f.user(50 * 10_000_000);
        f.client.lock_float(&u, &102_000_000, &ev, &FARE, &RATE, &f.device(i + 20));
    }

    for g in &gates {
        assert_eq!(f.client.gate_load(g), 2, "kapi {g:?} yuku dengeli olmali");
    }
}

#[test]
fn assign_gate_picks_least_loaded() {
    let f = setup();
    let ev = symbol_short!("EVT1");
    f.client.register_gate(&ev, &symbol_short!("M307"));
    f.client.register_gate(&ev, &symbol_short!("M308"));

    let u = f.user(50 * 10_000_000);
    f.client.lock_float(&u, &102_000_000, &ev, &FARE, &RATE, &f.device(30));
    // Ilk kullanici M307'ye gitti; siradaki bos kapi M308 olmali.
    assert_eq!(f.client.assign_gate(&ev), symbol_short!("M308"));
}

#[test]
fn assign_gate_fails_for_unknown_event() {
    let f = setup();
    assert!(f.client.try_assign_gate(&Symbol::new(&f.e, "YOKEVENT")).is_err());
}

// --- Ucret matematigi ------------------------------------------------------

#[test]
fn fare_conversion_matches_locked_rate() {
    // 100.00 TL / 48.785078 = 2.0498... USDC
    let stroops = fare_in_stroops(FARE, RATE);
    assert_eq!(stroops, 20_498_071);

    // Kur yukselse bile ayni Acct'teki kilitli kur kullanildigi icin
    // TL fiyati sabit kalir; USDC karsiligi kurla birlikte degisir.
    let cheaper = fare_in_stroops(FARE, 600_000_000); // 1 USDC = 60 TRY
    assert_eq!(cheaper, 16_666_666);
    assert!(cheaper < stroops);
}
