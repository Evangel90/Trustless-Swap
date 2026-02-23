//this module implements the escrow mechanism for a trustless swap using the lock mechanism defined in lock.move.
module trustless_swap::shared_escrow;

use trustless_swap::lock::{Locked, Key};
use sui::dynamic_object_field as dof;
use sui::event;

//name of dof that holds the escrowed object
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

public struct EscrowCancelled has copy, drop{
    escrow_id: ID,
}

//test event to check if indexer is working
public struct SharedIndexerWorking has copy, drop{
    tx_sender: address,
}

const EMismatchedSenderRecipient: u64 = 0;

const EMismatchedExchangeObject: u64 = 1;

//this function creates and shares an escrow for a given asset T and it's corresponding exchange key.
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

//this function allows the recipient to swap the escrowed object for the locked object by providing the correct exchange key
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
    
    //makes sure caller is interacting with the right escrow and has the right key to swap
    assert!(recipient == ctx.sender(), EMismatchedSenderRecipient);
    assert!(exchange_key == object::id(&key), EMismatchedExchangeObject);

    transfer::public_transfer(locked.unlock(key), sender);

    event::emit(EscrowSwapped {
        escrow_id: id.to_inner(),
    });

    id.delete();

    escrowed
}

//this returns the escrowed object and deletes the escrow.
public fun return_to_sender<T: key + store>(mut escrow: Escrow<T>, ctx: &TxContext): T{
    event::emit(EscrowCancelled{
        escrow_id: object::id(&escrow),
    }); 

    let escrowed = dof::remove<EscrowedObjectKey, T>(&mut escrow.id, EscrowedObjectKey{});

    let Escrow {
        id,
        sender,
        recipient:_,
        exchange_key: _,
    } = escrow;

    assert!(sender == ctx.sender(), EMismatchedSenderRecipient);
    id.delete();
    escrowed
}

//test indexer
public fun emit_test_event(ctx: &TxContext){
    event::emit(SharedIndexerWorking{
        tx_sender: ctx.sender(),
    }); 
}

