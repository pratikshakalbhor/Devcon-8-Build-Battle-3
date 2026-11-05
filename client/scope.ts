import { encodeAbiParameters, keccak256, parseAbiParameters, type Address } from "viem"

/**
 * Computes the ballot scope exactly the way `AnonBallot.createBallot` does:
 *
 *     uint256 scope = uint256(keccak256(abi.encode(address(this), ballotId)));
 *
 * The scope is derived ONLY from contract state - never from the caller, the
 * timestamp, or anything the voter supplies. It is what makes a proof valid for
 * exactly one ballot, and it is what makes the nullifier ballot-specific.
 */
export function ballotScope(ballotAddress: Address, ballotId: number | bigint): bigint {
    return BigInt(
        keccak256(
            encodeAbiParameters(parseAbiParameters("address, uint256"), [ballotAddress, BigInt(ballotId)])
        )
    )
}
