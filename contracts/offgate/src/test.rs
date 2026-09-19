#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

#[test]
fn init_stores_config_and_is_idempotent_guarded() {
    let e = Env::default();
    e.mock_all_auths();

    let id = e.register(OffGate, ());
    let client = OffGateClient::new(&e, &id);

    let admin = Address::generate(&e);
    let token = Address::generate(&e);
    let op_pk = BytesN::from_array(&e, &[7u8; 32]);

    client.init(&admin, &token, &op_pk);

    assert_eq!(client.admin(), admin);
    assert_eq!(client.token(), token);
    assert_eq!(client.operator_pk(), op_pk);
    assert_eq!(client.version(), 1);

    // Ikinci kurulum reddedilmeli.
    assert!(client.try_init(&admin, &token, &op_pk).is_err());
}
