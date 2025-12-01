#[test_only]
module trustless_swap::trustless_swap_tests;

use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::test_scenario::{Self as ts, Scenario};
use trustless_swap::lock::{lock, ELockKeyMismatch};


fun test_coin(ts: &mut Scenario): Coin<SUI> {
    coin::mint_for_testing<SUI>(42, ts.ctx())
}

#[test]
fun test_lock_unlock(){
    let mut ts = ts::begin(@0xA);
    let coin = test_coin(&mut ts);

    let (lock, key) = lock(coin, ts.ctx());
    let coin = lock.unlock(key);

    coin.burn_for_testing();
    ts.end();
}

#[test, expected_failure(abort_code = ELockKeyMismatch)]
fun test_lock_unlock_fail_wrong_key(){
    let mut ts = ts::begin(@0xA);

    let coin1 = test_coin(&mut ts);
    let coin2 = test_coin(&mut ts);
    
    let (lock1, _key1) = lock(coin1, ts.ctx());
    let (_lock2, key2) = lock(coin2, ts.ctx());

    let _coin1 = lock1.unlock(key2);

    abort 1337
}
