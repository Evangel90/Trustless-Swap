module trustless_swap::lock;

use sui::dynamic_object_field as dof;
use sui::event;

//Name of the dof that holds the locked object
public struct LockedObjectKey has copy, drop, store {}

public struct Locked<phantom T: key + store> has key, store {
    id: UID,
    key: ID,
}

public struct LockCreated has copy, drop{
    lock_id: ID,
    key_id: ID,
    creator: address,
    item_id: ID,
}

public struct Key has key, store { id: UID }

// const ELockKeyMismatch: u64 = 0;

public fun lock<T: key + store>(obj: T, ctx: &mut TxContext): (Locked<T>, Key){
    let key = Key {
        id: object::new(ctx),
    };

    let mut lock: Locked<T> = Locked{
        id: object::new(ctx),
        key: object::id(&key),
    };

    event::emit(LockCreated {
        lock_id: object::id(&lock),
        key_id: object::id(&key),
        creator: ctx.sender(),
        item_id: object::id(&obj),
    });

    dof::add(&mut lock.id, LockedObjectKey {}, obj);

    (lock, key)
}
