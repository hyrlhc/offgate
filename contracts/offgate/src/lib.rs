#![no_std]
//! OffGate — internetsiz gecis ve odeme altyapisi.
//!
//! P1 iskeleti: kurulum (init) ve okuma fonksiyonlari.
//! lock_float / assign_gate  -> P3
//! settle / refund / stats   -> P4

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, BytesN, Env};

/// Kalici veri anahtarlari. `Instance` kapsamindakiler kurulum sabitleri,
/// `Persistent` kapsamindakiler (P3'te gelecek) kullanici bakiyeleri.
#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Token,
    OperatorPk,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
}

#[contract]
pub struct OffGate;

#[contractimpl]
impl OffGate {
    /// Tek seferlik kurulum. Admin, USDC token adresi ve operatorun
    /// entitlement imzalarini dogrulamakta kullanilacak Ed25519 acik anahtari.
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

    pub fn admin(e: Env) -> Result<Address, Error> {
        e.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    pub fn token(e: Env) -> Result<Address, Error> {
        e.storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)
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
