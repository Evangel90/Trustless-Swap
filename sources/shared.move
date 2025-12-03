module trustless_swap::shared_escrow;

use trustless_swap::lock::{Locked, Key};
use sui::dynamic_object_field as dof;
use sui::event;

public struct EscrowedObjectKey has copy, drop, store {}

public struct Escrow<phantom T: key + store> has key, store {
    id: UID,
    sender: address,
    recipient: address,
    exchange_key: ID,
}

public struct EscrowCreated has copy, drop{
    escrow_id: ID,
    key_id: ID,
    sender: address,
    recipient: address,
    item_id: ID,
}

public struct EscrowSwapped has copy, drop{
    escrow_id: ID,
}

const EMismatchedSenderRecipient: u64 = 0;

const EMismatchedExchangeObject: u64 = 1;

public fun create<T: key + store>(
    escrowed: T,
    exchange_key: ID,
    recipient: address,
    ctx: &mut TxContext
){
    let mut escrow = Escrow<T>{
        id: object::new(ctx),
        sender: ctx.sender(),
        recipient,
        exchange_key,
    };

    event::emit(EscrowCreated{
        escrow_id: object::id(&escrow),
        key_id: exchange_key,
        sender: escrow.sender,
        recipient,
        item_id: object::id(&escrowed),
    });

    dof::add(&mut escrow.id, EscrowedObjectKey {}, escrowed);

    transfer::public_share_object(escrow);
}

public fun swap<T: key + store, U: key + store>(
    mut escrow: Escrow<T>,
    key: Key,
    locked: Locked<U>,
    ctx: &mut TxContext,
): T{
    let escrowed = dof::remove<EscrowedObjectKey, T>(&mut escrow.id, EscrowedObjectKey {});

    let Escrow {
        id,
        sender,
        recipient,
        exchange_key,
    } = escrow;

    assert!(recipient == ctx.sender(), EMismatchedSenderRecipient);
    assert!(exchange_key == object::id(&key), EMismatchedExchangeObject);

    transfer::public_transfer(locked.unlock(key), sender);

    event::emit(EscrowSwapped {
        escrow_id: id.to_inner(),
    });

    id.delete();

    escrowed
}