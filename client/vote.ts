import { Group, Identity, generateProof, type SemaphoreProof } from "@semaphore-protocol/core"
import type { Address } from "viem"

/** `ISemaphore.SemaphoreProof` as the EVM expects it: every field a uint256. */
export interface ContractSemaphoreProof {
    merkleTreeDepth: bigint
    merkleTreeRoot: bigint
    nullifier: bigint
    message: bigint
    scope: bigint
    points: readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]
}

/**
 * Everything the client sends for one vote. Note what is NOT here: no identity,
 * no identity secret, no commitment, no signature from a nurse wallet. The only
 * sender-side key material is the relayer's, which signs the transaction itself.
 */
export interface CastVoteRequest {
    address: Address
    functionName: "castVote"
    args: readonly [bigint, ContractSemaphoreProof]
}

/** Injectable so the request builder can be unit-tested without running a SNARK prover. */
export type ProofGenerator = (
    identity: Identity,
    group: Group,
    message: number,
    scope: bigint
) => Promise<SemaphoreProof>

const defaultGenerator: ProofGenerator = (identity, group, message, scope) =>
    generateProof(identity, group, message, scope)

/**
 * Builds the `castVote` call.
 *
 * The identity is used ONLY to produce the zero-knowledge proof; it is never part of
 * the returned request. The option the voter chose becomes `proof.message`, and the
 * scope must be the ballot's on-chain scope (see `ballotScope`).
 */
export async function buildCastVoteRequest(params: {
    ballotAddress: Address
    ballotId: number | bigint
    identity: Identity
    members: readonly bigint[]
    option: number
    scope: bigint
    generate?: ProofGenerator
}): Promise<CastVoteRequest> {
    const { ballotAddress, ballotId, identity, members, option, scope } = params
    const generate = params.generate ?? defaultGenerator

    if (!Number.isInteger(option) || option < 0) throw new Error(`Option must be a non-negative integer, got ${option}`)
    if (members.length === 0) throw new Error("Cannot build a group with zero members")
    if (!members.some((m) => m === identity.commitment)) {
        throw new Error("This identity is not a member of the ballot's group")
    }

    // Group is rebuilt from the public membership list - the same LeanIMT the chain holds.
    const group = new Group([...members])

    // The identity never leaves this call.
    const proof = await generate(identity, group, option, scope)

    return {
        address: ballotAddress,
        functionName: "castVote",
        args: [BigInt(ballotId), toContractProof(proof)]
    }
}

/** Converts a `@semaphore-protocol/core` proof into the Solidity struct. */
export function toContractProof(proof: SemaphoreProof): ContractSemaphoreProof {
    const points = proof.points.map((p) => BigInt(p)) as [
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
        bigint
    ]
    if (points.length !== 8) throw new Error(`Expected 8 Groth16 points, got ${points.length}`)

    return {
        merkleTreeDepth: BigInt(proof.merkleTreeDepth),
        merkleTreeRoot: BigInt(proof.merkleTreeRoot),
        nullifier: BigInt(proof.nullifier),
        message: BigInt(proof.message),
        scope: BigInt(proof.scope),
        points
    }
}
