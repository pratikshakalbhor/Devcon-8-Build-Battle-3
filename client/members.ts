import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type { Address, PublicClient } from "viem"
import { semaphoreAbi } from "./abi"

/**
 * Identity commitments are PUBLIC data. They are what the ward admin (Priya) holds.
 * A commitment on its own reveals nothing about which vote it later casts, but the
 * list of commitments does reveal who is in the group - see README "Who can learn what".
 */
export interface StoredCommitments {
    version: 1
    groupId: string
    commitments: string[]
}

export function saveCommitments(path: string, groupId: bigint, commitments: readonly bigint[]): void {
    const stored: StoredCommitments = {
        version: 1,
        groupId: groupId.toString(),
        commitments: commitments.map((c) => c.toString())
    }
    mkdirSync(dirname(resolve(path)), { recursive: true })
    writeFileSync(path, `${JSON.stringify(stored, null, 2)}\n`, "utf8")
}

export function loadCommitments(path: string): { groupId: bigint; commitments: bigint[] } {
    if (!existsSync(path)) throw new Error(`Commitments file not found: ${path}`)
    const stored = JSON.parse(readFileSync(path, "utf8")) as StoredCommitments
    if (stored.version !== 1 || !Array.isArray(stored.commitments)) {
        throw new Error(`Unrecognised commitments file format: ${path}`)
    }
    return { groupId: BigInt(stored.groupId), commitments: stored.commitments.map(BigInt) }
}

/**
 * Rebuilds the group membership from the Semaphore contract's public `MemberAdded` /
 * `MembersAdded` events. This is how `vote` obtains the leaves: the membership list is
 * already public, so reading it from chain requires no privileged access.
 */
export async function loadMembersFromChain(params: {
    publicClient: PublicClient
    semaphore: Address
    groupId: bigint
}): Promise<bigint[]> {
    const { publicClient, semaphore, groupId } = params
    const common = { abi: semaphoreAbi, address: semaphore, fromBlock: 0n, toBlock: "latest" } as const

    const [single, batched] = await Promise.all([
        publicClient.getContractEvents({ ...common, eventName: "MemberAdded", args: { groupId } }),
        publicClient.getContractEvents({ ...common, eventName: "MembersAdded", args: { groupId } })
    ])

    const leaves = new Map<string, { index: bigint; commitment: bigint }>()

    for (const log of single) {
        if (log.args.index === undefined || log.args.identityCommitment === undefined) continue
        leaves.set(log.args.identityCommitment.toString(), {
            index: log.args.index,
            commitment: log.args.identityCommitment
        })
    }
    for (const log of batched) {
        if (log.args.startIndex === undefined || log.args.identityCommitments === undefined) continue
        log.args.identityCommitments.forEach((commitment, offset) => {
            leaves.set(commitment.toString(), {
                index: log.args.startIndex! + BigInt(offset),
                commitment
            })
        })
    }

    return [...leaves.values()].sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0)).map((l) => l.commitment)
}
