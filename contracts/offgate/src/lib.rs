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

/// Kapinin kendi anahtariyla imzaladigi tahsilat belgesi.
///   "OFFGATE-VCHR-v1" (15) || ent_hash (32) || seq (4, BE)
///   || charged_try (8, BE) || ts (8, BE)
///
/// Kapi kimligi mesajin ICINDE YOK; imzayi dogrulayan acik anahtar zaten
/// hangi kapi oldugunu soyluyor. Ayni gerekce fis mesajinda da gecerli
/// (karar K-4): Soroban'da `Symbol` -> bayt donusumu wasm icinde yok.
const VCHR_DOMAIN: &[u8; 15] = b"OFFGATE-VCHR-v1";
const VCHR_MSG_LEN: u32 = 67;

/// Kapinin kendi gecis sayacini imzaladigi beyan.
///   "OFFGATE-RPRT-v1" (15) || counter (4, BE) || ts (8, BE)
const RPRT_DOMAIN: &[u8; 15] = b"OFFGATE-RPRT-v1";

/// Cevrimdisi bakiye yuklemenin hizmet bedeli — on binde (500 = %5).
///
/// Bu bir komisyon degil, TEMINAT: kapi verisini zincire tasiyan kullaniciya
/// `REBATE_PCT` kadari geri odenir. Sistemi isletmenin gercek marjinal
/// maliyeti anchor makasi kadardir (~%1); geri kalani veriyi tasimayanlardan
/// alinir, cunku operatorun senkronizasyonu onlar icin yapmasi gerekir.
const FEE_BPS: i128 = 500;

/// Tasinan her gecis icin hizmet bedelinin geri odenen yuzdesi.
const REBATE_PCT: i128 = 80;

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
    /// Kapinin ham Ed25519 ACIK anahtari. Tahsilat belgeleri bununla
    /// dogrulanir; boylece sozlesme belgenin gercekten yetkili bir
    /// turnikeden geldigini bilir.
    GatePk(Symbol),
    /// Kapinin bagli oldugu etkinlik. Bir kapi yalnizca tek bir etkinlige
    /// ait olabilir: sayaclar kapi bazinda tutuldugu icin, ayni kapi iki
    /// etkinlikte kayitli olsaydi `stats` yanlis sayi dondururdu.
    GateEvent(Symbol),
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
    /// Bu hesap icin bugune kadar imzalanan TOPLAM gecis hakki.
    /// Her `top_up` bunu artirir; hicbir zaman azalmaz.
    pub granted: u32,
    /// Zincire dusmus (settle edilmis) fis sayisi.
    pub used: u32,
    /// Yururlukteki entitlement'in kendi gecis hakki. Kapinin gordugu sayi
    /// budur; her bilet kendi sira numarasi uzayina sahiptir.
    pub ent_uses: u32,
    /// Alinan ama henuz kullanilmamis hizmet bedeli, USDC stroop.
    /// Kullanici kapi verisini zincire tasidikca buradan iade edilir.
    pub fee_held: i128,
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
    /// Biletin izin verdigi UST SINIR, kurus. Kullanicinin imzaladigi tutar.
    pub fare_try: i128,
    pub ts: u64,
    pub sig: BytesN<64>,
    /// Kapinin FIILEN tahsil ettigi tutar, kurus. `fare_try`den kucuk
    /// olabilir: 100 TL'lik banknotla 80 TL'lik kapidan gecilirse 20 TL
    /// kullanicinin bakiyesinde kalir — para ustu.
    ///
    /// Kapi bunu kendi anahtariyla imzaladigi icin fazla tahsil edemez
    /// (ust sinir kullanicinin imzasinda), eksik beyan da isine gelmez
    /// (parayi operator alir).
    pub charged_try: i128,
    /// Tahsilat belgesinin kapi imzasi.
    pub gate_sig: BytesN<64>,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    /// Etkinlige kayitli kapi yok.
    NoGates = 3,
    /// Kapi zaten kayitli — ayni ya da baska bir etkinlikte.
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
    /// Kapinin acik anahtari kayitli degil — tahsilat belgesi dogrulanamaz.
    GateKeyMissing = 11,
    /// Iade edilebilecek serbest bakiye yok: imzalanmis haklar acikta.
    NothingToRefund = 12,
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

/// Acik bilete bakiye eklendi, yeni bir entitlement yururluge girdi.
#[contractevent]
#[derive(Clone)]
pub struct ToppedUp {
    #[topic]
    pub user: Address,
    pub amount: i128,
    pub grant: u32,
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
    /// Veriyi tasiyanlara iade edilen toplam hizmet bedeli.
    pub rebated: i128,
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

/// Kapinin imzaladigi tahsilat belgesinin kanonik baytlari (67 bayt).
/// ESP32 tarafiyla birebir ayni olmalidir.
fn voucher_message(e: &Env, ent_hash: &BytesN<32>, seq: u32, charged_try: i128, ts: u64) -> Bytes {
    let mut msg = Bytes::from_array(e, VCHR_DOMAIN);
    msg.append(&Bytes::from(ent_hash.clone()));
    msg.extend_from_array(&seq.to_be_bytes());
    msg.extend_from_array(&(charged_try as u64).to_be_bytes());
    msg.extend_from_array(&ts.to_be_bytes());
    debug_assert_eq!(msg.len(), VCHR_MSG_LEN);
    msg
}

/// Yuklenen tutari, hizmet bedeli ile kullanilabilir bakiyeye ayirir.
/// Bakiye asagi yuvarlanir; kalan bedel olarak tutulur.
fn split_fee(amount: i128) -> (i128, i128) {
    let balance = amount * 10_000 / (10_000 + FEE_BPS);
    (balance, amount - balance)
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
    ///
    /// `gate_pk`, turnikenin ilk aciliste uretip NVS'inde tuttugu Ed25519
    /// anahtar ciftinin ACIK tarafidir (seri portta basilir). Sozlesme
    /// tahsilat belgelerini bununla dogrular: belge gercekten o kapidan
    /// geliyorsa imza tutar, aksi halde tutmaz.
    pub fn register_gate(
        e: Env,
        event: Symbol,
        gate: Symbol,
        gate_pk: BytesN<32>,
    ) -> Result<(), Error> {
        cfg_address(&e, DataKey::Admin)?.require_auth();

        // Bir kapi yalnizca tek bir etkinlige ait olabilir (bkz. GateEvent).
        let owner_key = DataKey::GateEvent(gate.clone());
        if e.storage().persistent().has(&owner_key) {
            return Err(Error::GateExists);
        }

        let gates_key = DataKey::Gates(event.clone());
        let mut gates: Vec<Symbol> = e
            .storage()
            .persistent()
            .get(&gates_key)
            .unwrap_or_else(|| Vec::new(&e));
        gates.push_back(gate.clone());
        e.storage().persistent().set(&gates_key, &gates);
        bump(&e, &gates_key);

        let load_key = DataKey::GateLoad(gate.clone());
        e.storage().persistent().set(&load_key, &0u32);
        bump(&e, &load_key);

        e.storage().persistent().set(&owner_key, &event);
        bump(&e, &owner_key);

        let pk_key = DataKey::GatePk(gate.clone());
        e.storage().persistent().set(&pk_key, &gate_pk);
        bump(&e, &pk_key);

        GateRegistered { event, gate }.publish(&e);
        Ok(())
    }

    /// Kayitli bir kapinin acik anahtarini gunceller. Yalnizca admin.
    ///
    /// Anahtar dondurmek zorunlu bir islem: turnike bozulup degistirilirse
    /// yeni cihazin anahtari farklidir, ve bir kapinin anahtari hic
    /// degistirilemiyorsa cihaz arizasi butun kapiyi kalici olarak olduruyor
    /// demektir. Eski anahtarla imzalanmis, henuz tasinmamis belgeler bu
    /// noktada gecersiz olur — bu yuzden once fisler toplanmali.
    pub fn set_gate_pk(e: Env, gate: Symbol, gate_pk: BytesN<32>) -> Result<(), Error> {
        cfg_address(&e, DataKey::Admin)?.require_auth();
        if !e.storage().persistent().has(&DataKey::GateEvent(gate.clone())) {
            return Err(Error::UnknownGate);
        }
        let key = DataKey::GatePk(gate);
        e.storage().persistent().set(&key, &gate_pk);
        bump(&e, &key);
        Ok(())
    }

    /// Kapinin zincirdeki acik anahtari. Turnikenin seri portta bastigi
    /// kimlikle karsilastirilarak kaydin guncelligi dogrulanir.
    pub fn gate_pk_of(e: Env, gate: Symbol) -> Result<BytesN<32>, Error> {
        e.storage()
            .persistent()
            .get(&DataKey::GatePk(gate))
            .ok_or(Error::GateKeyMissing)
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
        // Hizmet bedeli tutarin icinden ayrilir; gecis hakki yalnizca
        // kullanilabilir bakiyeden hesaplanir.
        let (balance, fee) = split_fee(amount);
        if balance < fare_in_stroops(fare_try, rate) {
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

        // Gecis hakkini kontrat hesaplar; istemciden hicbir sayi alinmaz.
        let uses = (balance / fare_in_stroops(fare_try, rate)) as u32;

        let acct = Acct {
            balance,
            locked: amount,
            event: event.clone(),
            gate: gate.clone(),
            fare_try,
            rate,
            device_pk,
            ent_hash,
            granted: uses,
            used: 0,
            ent_uses: uses,
            fee_held: fee,
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

    /// Acik bir bilete bakiye ekler ve YENI bir entitlement yururluge koyar.
    ///
    /// Tekrar bilet almanin yolu budur: iade gerekmez, kullanici kilidini
    /// bozmaz. Onemli olan yeni biletin kac gecis vermesi gerektigi.
    ///
    /// Kapilar cevrimdisi oldugu icin, eski biletin imzalanmis haklarinin
    /// kapida harcanip harcanmadigini zincir BILEMEZ. Bu yuzden en kotu
    /// ihtimali varsayiyoruz: imzalanmis ama henuz zincire dusmemis her hak
    /// harcanmis sayilir.
    ///
    ///   acikta_kalan = granted - used          (en kotu ihtimalle harcanmis)
    ///   yeni_hak     = bakiye / ucret - acikta_kalan
    ///
    /// Boylece imzalanan toplam hak hicbir zaman yatirilan paranin
    /// karsiladigi gecis sayisini asmaz — kapilar birbirinden ve zincirden
    /// habersiz olsa bile.
    pub fn top_up(
        e: Env,
        user: Address,
        amount: i128,
        ent_hash: BytesN<32>,
    ) -> Result<u32, Error> {
        user.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let acct_key = DataKey::Acct(user.clone());
        let mut acct: Acct = e
            .storage()
            .persistent()
            .get(&acct_key)
            .ok_or(Error::NoAccount)?;

        let token_addr = cfg_address(&e, DataKey::Token)?;
        token::Client::new(&e, &token_addr).transfer(
            &user,
            &e.current_contract_address(),
            &amount,
        );

        let (added, fee) = split_fee(amount);
        acct.balance += added;
        acct.locked += amount;
        acct.fee_held += fee;

        let grant = Self::grant_for(&acct);
        if grant < 1 {
            return Err(Error::AmountBelowFare);
        }

        acct.granted += grant;
        acct.ent_uses = grant;
        acct.ent_hash = ent_hash;
        e.storage().persistent().set(&acct_key, &acct);
        bump(&e, &acct_key);

        ToppedUp {
            user,
            amount,
            grant,
        }
        .publish(&e);
        Ok(grant)
    }

    /// `top_up` cagrilsa kac gecis hakki verilecegini onceden soyler.
    ///
    /// Istemci entitlement ozetini kurmak icin bu sayiyi bilmek zorunda;
    /// zincire yazilan ozetle operatorun imzaladigi belge birebir tutmali
    /// (karar K-9).
    pub fn next_grant(e: Env, user: Address, amount: i128) -> Result<u32, Error> {
        let mut acct = Self::account_of(e, user)?;
        let (added, _fee) = split_fee(amount);
        acct.balance += added;
        Ok(Self::grant_for(&acct))
    }

    /// Istenen gecis sayisi icin hizmet bedeli dahil odenecek toplam tutar.
    /// Arayuz "4 x 100 TL + %5 teminat" satirini bununla yazar.
    pub fn quote_total(e: Env, fare_try: i128, rate: i128, passes: u32) -> i128 {
        let _ = &e;
        let net = fare_in_stroops(fare_try, rate) * passes as i128;
        // Yukari yuvarla: sozlesme tarafinda asagi yuvarlanacak.
        (net * (10_000 + FEE_BPS) + 9_999) / 10_000
    }

    /// Offline toplanan fisleri zincire yazar, hasilati operatore aktarir ve
    /// veriyi tasiyana hizmet bedelini iade eder.
    ///
    /// **Izin gerektirmez.** Her fis kendi kendini dogrular: kullanicinin
    /// cihaz imzasi tutarin UST SINIRINI, kapinin imzasi FIILEN tahsil edilen
    /// tutari baglar. Veriyi kimin tasidiginin onemi yok — bu yuzden
    /// kullanicilar kendi verilerini tasiyabilir. Tasidiklari icin bedelin
    /// `REBATE_PCT` kadari geri odenir; boylece senkronizasyonu operatorun
    /// yapmasina gerek kalmaz, sistem kendi kendini kapatir.
    ///
    /// **Para ustu:** dusulen tutar biletin ust siniri degil, kapinin
    /// imzaladigi `charged_try`dir. 100 TL'lik hakla 80 TL'lik kapidan gecen
    /// kullanicinin 20 TL'si bakiyesinde kalir.
    ///
    /// **Idempotent:** ayni fis ikinci kez gonderilirse sessizce atlanir.
    ///
    /// **Gecersiz imza batch'i durdurur.** `ed25519_verify` basarisizlikta
    /// panik atar; kapi zaten kabul anindan once dogruladigi icin normal
    /// akista sahte fis buraya hic ulasmaz.
    pub fn settle(e: Env, gate: Symbol, receipts: Vec<Receipt>) -> Result<u32, Error> {
        let gate_pk: BytesN<32> = e
            .storage()
            .persistent()
            .get(&DataKey::GatePk(gate.clone()))
            .ok_or(Error::GateKeyMissing)?;
        let gate_event: Symbol = e
            .storage()
            .persistent()
            .get(&DataKey::GateEvent(gate.clone()))
            .ok_or(Error::UnknownGate)?;

        let submitted = receipts.len();
        let mut accepted: u32 = 0;
        let mut total: i128 = 0;
        let mut rebated: i128 = 0;

        let token_addr = cfg_address(&e, DataKey::Token)?;
        let token_client = token::Client::new(&e, &token_addr);

        for r in receipts.iter() {
            let acct_key = DataKey::Acct(r.user.clone());
            let Some(mut acct) = e.storage().persistent().get::<_, Acct>(&acct_key) else {
                continue; // Hesap yok ya da iade edilmis.
            };
            // Kapi, biletin ETKINLIGINE kayitli olmali. Biletin kendi kapisi
            // olmasi sart degil: komsu kapi, sahibinden imzali izin alarak
            // gecis verebiliyor (kapilar arasi soru/onay protokolu).
            if gate_event != acct.event
                || acct.ent_hash != r.ent_hash
                || acct.fare_try != r.fare_try
            {
                continue;
            }
            // Kapi ust sinirin uzerinde tahsil edemez: ust sinir kullanicinin
            // imzaladigi tutardir.
            if r.charged_try <= 0 || r.charged_try > r.fare_try {
                continue;
            }

            let spent_key = DataKey::Spent(r.ent_hash.clone(), r.seq);
            if e.storage().persistent().has(&spent_key) {
                continue; // Zaten harcanmis — tekrar ya da mukerrer gonderim.
            }

            let charged = fare_in_stroops(r.charged_try, acct.rate);
            if acct.balance < charged {
                continue; // Bakiye tukenmis.
            }

            // Kullanicinin imzasi: ust siniri ve sira numarasini baglar.
            e.crypto().ed25519_verify(
                &acct.device_pk,
                &receipt_message(&e, &r.ent_hash, r.seq, r.fare_try, r.ts),
                &r.sig,
            );
            // Kapinin imzasi: fiilen tahsil edilen tutari baglar ve belgenin
            // yetkili bir turnikeden geldigini kanitlar.
            e.crypto().ed25519_verify(
                &gate_pk,
                &voucher_message(&e, &r.ent_hash, r.seq, r.charged_try, r.ts),
                &r.gate_sig,
            );

            e.storage().persistent().set(&spent_key, &true);
            bump(&e, &spent_key);

            let fare = fare_in_stroops(acct.fare_try, acct.rate);
            let could_afford = acct.balance >= fare;

            acct.balance -= charged;
            acct.used += 1;

            // Hizmet bedelinin iadesi — veriyi zincire tasimanin karsiligi.
            let rebate = (charged * FEE_BPS * REBATE_PCT / (10_000 * 100)).min(acct.fee_held);
            if rebate > 0 {
                acct.fee_held -= rebate;
            }

            e.storage().persistent().set(&acct_key, &acct);
            bump(&e, &acct_key);

            // Bilet tam ucretli bir gecisi artik karsilamiyorsa kapinin yuku
            // serbest kalsin. Gecisten ONCEKI durumu da kontrol ediyoruz ki
            // kosul yalnizca bir kez tutsun: degisken tahsilatta "bakiye <
            // ucret" birden fazla fiste dogru olabilirdi ve yuk fazla duserdi.
            if could_afford && acct.balance < fare {
                Self::add_load(&e, &acct.gate, -1);
            }

            // Etkinlik hasilati denetim ekrani icin biriktiriliyor.
            let rev_key = DataKey::Revenue(acct.event.clone());
            let prev_rev: i128 = e.storage().persistent().get(&rev_key).unwrap_or(0);
            e.storage().persistent().set(&rev_key, &(prev_rev + charged));
            bump(&e, &rev_key);

            if rebate > 0 {
                token_client.transfer(&e.current_contract_address(), &r.user, &rebate);
                rebated += rebate;
            }

            total += charged;
            accepted += 1;
        }

        if total > 0 {
            let operator = cfg_address(&e, DataKey::Operator)?;
            token_client.transfer(&e.current_contract_address(), &operator, &total);

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
            rebated,
        }
        .publish(&e);
        Ok(accepted)
    }

    /// Kapinin kendi gecis sayaci — KAPININ KENDI IMZASIYLA.
    ///
    /// Izin gerektirmez: sayiyi operator degil turnikenin kendisi imzalar,
    /// bu yuzden tasiyicinin kim oldugu onemsizdir. Denetimin anlami da
    /// buradan geliyor — beyan ile zincirdeki fis sayisi artik gercekten
    /// bagimsiz iki kaynaktan gelir. Eskiden beyani operator yaziyordu ve
    /// "bagimsiz" iddiasi yalnizca sozdeydi.
    pub fn gate_report(
        e: Env,
        gate: Symbol,
        counter: u32,
        ts: u64,
        sig: BytesN<64>,
    ) -> Result<(), Error> {
        let gate_pk: BytesN<32> = e
            .storage()
            .persistent()
            .get(&DataKey::GatePk(gate.clone()))
            .ok_or(Error::GateKeyMissing)?;

        let mut msg = Bytes::from_array(&e, RPRT_DOMAIN);
        msg.extend_from_array(&counter.to_be_bytes());
        msg.extend_from_array(&ts.to_be_bytes());
        e.crypto().ed25519_verify(&gate_pk, &msg, &sig);

        // Sayac yalnizca ileri gider: eski bir imzali rapor tekrar oynatilarak
        // beyan dusurulemez.
        let key = DataKey::Declared(gate.clone());
        let prev: u32 = e.storage().persistent().get(&key).unwrap_or(0);
        if counter <= prev {
            return Ok(());
        }
        e.storage().persistent().set(&key, &counter);
        bump(&e, &key);
        GateReported { gate, counter }.publish(&e);
        Ok(())
    }

    /// Harcanmayan bakiyeyi kullaniciya geri verir.
    ///
    /// **Acikta kalan imzali haklar iade edilmez.** Kapilar cevrimdisi oldugu
    /// icin, imzalanmis bir hakkin kapida kullanilip kullanilmadigini zincir
    /// bilemez. En kotu ihtimali varsayip her acik hakki bir tam ucret olarak
    /// rezerve ediyoruz; yalnizca ustu iade edilir.
    ///
    /// Eskiden butun bakiye iade ediliyordu: kullanici kapidan gecip, fisler
    /// zincire yazilmadan once iade alabiliyor ve o gecisler bedava kaliyordu.
    /// Bu deligi kapatan sey rezervasyon; kullaniciyi magdur etmeyen sey ise
    /// iade tesviki — fislerini kendisi tasiyinca `used` artar, rezerv duser
    /// ve para ayni islemde serbest kalir.
    ///
    /// Hizmet bedeli de serbest bakiye oraninda geri verilir: tuketilmeyen
    /// gecis icin bedel alinmaz.
    pub fn refund(e: Env, user: Address) -> Result<i128, Error> {
        user.require_auth();

        let acct_key = DataKey::Acct(user.clone());
        let mut acct: Acct = e
            .storage()
            .persistent()
            .get(&acct_key)
            .ok_or(Error::NoAccount)?;

        let fare = fare_in_stroops(acct.fare_try, acct.rate);
        let outstanding = acct.granted.saturating_sub(acct.used) as i128;
        let reserved = (outstanding * fare).min(acct.balance);
        let free = acct.balance - reserved;

        // Tuketilmeyen kisma dusen hizmet bedeli de geri gider.
        let fee_back = if acct.balance > 0 {
            acct.fee_held * free / acct.balance
        } else {
            0
        };
        let amount = free + fee_back;
        if amount <= 0 {
            return Err(Error::NothingToRefund);
        }

        let token_addr = cfg_address(&e, DataKey::Token)?;
        token::Client::new(&e, &token_addr).transfer(
            &e.current_contract_address(),
            &user,
            &amount,
        );

        if reserved > 0 {
            // Acik haklar duruyor: hesap yasamaya devam etmeli, yoksa o
            // fisler hicbir zaman settle edilemez ve operator parasini alamaz.
            acct.balance -= free;
            acct.fee_held -= fee_back;
            e.storage().persistent().set(&acct_key, &acct);
            bump(&e, &acct_key);
        } else {
            // Kayit siliniyor; harcanmis fisler `Spent` altinda kaliyor,
            // boylece eski fisler yeni bir kilitte tekrar kullanilamaz.
            e.storage().persistent().remove(&acct_key);
            Self::add_load(&e, &acct.gate, -1);
        }

        Refunded { user, amount }.publish(&e);
        Ok(amount)
    }

    /// Simdi `refund` cagrilsa ne kadar geri gelir. Arayuz bunu gosterir ki
    /// kullanici "neden hepsi gelmedi" diye sormasin.
    pub fn refundable_of(e: Env, user: Address) -> Result<i128, Error> {
        let acct = Self::account_of(e, user)?;
        let fare = fare_in_stroops(acct.fare_try, acct.rate);
        let outstanding = acct.granted.saturating_sub(acct.used) as i128;
        let reserved = (outstanding * fare).min(acct.balance);
        let free = acct.balance - reserved;
        let fee_back = if acct.balance > 0 {
            acct.fee_held * free / acct.balance
        } else {
            0
        };
        Ok(free + fee_back)
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

    /// Kapinin bagli oldugu etkinlik.
    pub fn event_of(e: Env, gate: Symbol) -> Option<Symbol> {
        e.storage().persistent().get(&DataKey::GateEvent(gate))
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

    /// Bakiyenin karsiladigi gecis sayisindan, acikta kalan imzali haklari
    /// duserek guvenle verilebilecek yeni hakki bulur.
    fn grant_for(acct: &Acct) -> u32 {
        let capacity = (acct.balance / fare_in_stroops(acct.fare_try, acct.rate)) as u32;
        let outstanding = acct.granted.saturating_sub(acct.used);
        capacity.saturating_sub(outstanding)
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
