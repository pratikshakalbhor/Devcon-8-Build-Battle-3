/**
 * Generates the committed Semaphore proof vectors used by `test/AnonBallot.t.sol`.
 *
 * HOW TO RUN
 *   npx tsx scripts/generate-fixtures.ts
 *
 * HOW THE VECTORS WERE MADE
 *   1. Identities are NOT random: each is derived deterministically from a public
 *      seed string, so anybody can re-derive the exact same commitments:
 *
 *          privateKey_i = sha256("anvote-fixture-v1/voter/" + i)   (hex, utf-8)
 *
 *      These are throwaway test identities. No real nurse key material is used and
 *      no private key is written to disk - only public values (commitments, Merkle
 *      roots, proofs, nullifiers) end up in the fixture file.
 *   2. Groups are built with `new Group(commitments)` from @semaphore-protocol/core,
 *      which is the same LeanIMT the on-chain Semaphore contract maintains.
 *   3. Every proof comes from the real `generateProof(identity, group, message, scope)`
 *      of @semaphore-protocol/core (Groth16, snarkjs). Nothing is faked.
 *   4. `scope` is computed exactly like the contract does:
 *      keccak256(abi.encode(ballotAddress, ballotId)) using viem's ABI encoder.
 *      The ballot address is the fixed address the Foundry test etches AnonBallot
 *      onto (see `FIXED_BALLOT_ADDRESS` in test/AnonBallot.t.sol).
 *
 * The fixture contains ONLY public data.
 */
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Group, Identity, generateProof, type SemaphoreProof } from "@semaphore-protocol/core"
import { encodeAbiParameters, keccak256, parseAbiParameters } from "viem"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_FILE = resolve(HERE, "../test/fixtures/anonballot.vectors.json")

/** Fixed address the Foundry test etches AnonBallot onto, so scopes are reproducible. */
const BALLOT_ADDRESS = `0x${"0".repeat(36)}a11c`

/** Number of nurses in the ward group. */
const VOTERS = 38

/** Ballot A: optionCount 3 (see setUp in test/AnonBallot.t.sol). */
const OPTION_COUNT_A = 3

const STRIDE = 13 // depth, root, nullifier, message, scope, points[0..7]

const SEED_PREFIX = "anvote-fixture-v1"

function seedIdentity(tag: string): Identity {
    const privateKey = createHash("sha256").update(`${SEED_PREFIX}/${tag}`).digest("hex")
    return new Identity(privateKey)
}

/** Mirrors `uint256(keccak256(abi.encode(address(this), ballotId)))`. */
function scopeFor(ballotId: number): bigint {
    return BigInt(keccak256(encodeAbiParameters(parseAbiParameters("address, uint256"), [BALLOT_ADDRESS as `0x${string}`, BigInt(ballotId)])))
}

function block(proof: SemaphoreProof): string[] {
    return [
        proof.merkleTreeDepth.toString(),
        proof.merkleTreeRoot,
        proof.nullifier,
        proof.message,
        proof.scope,
        ...proof.points.map((p) => BigInt(p).toString())
    ]
}

async function main() {
    console.log(`ballot address : ${BALLOT_ADDRESS}`)
    console.log(`seed prefix    : ${SEED_PREFIX}`)

    // --- identities -------------------------------------------------------
    const voters = Array.from({ length: VOTERS }, (_, i) => seedIdentity(`voter/${i}`))
    // Not a member of the ward group: used by the non-member test.
    const outsider = seedIdentity(`outsider/0`)
    const outsiderGroup = new Group([outsider.commitment, seedIdentity(`outsider/1`).commitment, seedIdentity(`outsider/2`).commitment])

    const members = voters.map((v) => v.commitment)
    const groupA = new Group(members) //          order 0..37
    const groupB = new Group([...members].reverse()) // reversed -> different root
    const groupC = new Group(members)

    console.log(`group depth    : ${groupA.depth} (${groupA.size} members)`)
    console.log(`root A         : ${groupA.root}`)
    console.log(`root B         : ${groupB.root}`)
    console.log(`root C         : ${groupC.root}`)
    console.log(`root outsider  : ${outsiderGroup.root}`)
    if (groupA.root === groupB.root) throw new Error("group A and B must have different roots")

    const scopeA = scopeFor(0)
    const scopeB = scopeFor(1)
    const scopeC = scopeFor(2)
    console.log(`scope A        : ${scopeA}`)
    console.log(`scope B        : ${scopeB}`)
    console.log(`scope C        : ${scopeC}`)

    // --- single-purpose proofs -------------------------------------------
    const proofs: Record<string, SemaphoreProof> = {}
    const order: string[] = []

    const push = async (name: string, p: Promise<SemaphoreProof>) => {
        proofs[name] = await p
        order.push(name)
    }

    // voter 0 already voted on ballot A - a second, independently generated proof
    // from the same identity and scope carries the SAME nullifier.
    await push("valid", generateProof(voters[0]!, groupA, 0, scopeA))
    await push("doubleVote", generateProof(voters[0]!, groupA, 1, scopeA))
    // generated against ballot B's group + ballot B's scope
    await push("otherBallot", generateProof(voters[1]!, groupB, 1, scopeB))
    await push("closedBallot", generateProof(voters[2]!, groupC, 1, scopeC))
    // outsider proves membership of a group it belongs to, but with ballot A's scope
    await push("nonMember", generateProof(outsider, outsiderGroup, 0, scopeA))
    // message 5 is >= ballot A's optionCount (3)
    await push("outOfRange", generateProof(voters[3]!, groupA, 5, scopeA))
    // submitted by an unrelated relayer address
    await push("relayer", generateProof(voters[4]!, groupA, 2, scopeA))

    // --- 38 mixed votes for the tally test --------------------------------
    const tally38: SemaphoreProof[] = []
    const expectedTally = new Array<number>(OPTION_COUNT_A).fill(0)
    for (let i = 0; i < VOTERS; i += 1) {
        const option = i % OPTION_COUNT_A
        expectedTally[option] = (expectedTally[option] ?? 0) + 1
        tally38.push(await generateProof(voters[i]!, groupA, option, scopeA))
    }
    order.push("tally38")

    const nullifiers = tally38.map((p) => p.nullifier)
    if (new Set(nullifiers).size !== VOTERS) throw new Error("tally38 nullifiers must be unique")

    // --- assemble ----------------------------------------------------------
    const flat: string[] = []
    const proofIndex: Record<string, number> = {}
    for (const name of order) {
        if (name === "tally38") {
            proofIndex[name] = flat.length / STRIDE
            for (const p of tally38) flat.push(...block(p))
        } else {
            proofIndex[name] = flat.length / STRIDE
            flat.push(...block(proofs[name]!))
        }
    }

    const fixture = {
        version: 1,
        generator: "scripts/generate-fixtures.ts",
        seedPrefix: SEED_PREFIX,
        ballotAddress: BALLOT_ADDRESS,
        stride: STRIDE,
        voterCount: VOTERS,
        optionCountA: OPTION_COUNT_A,
        groupDepth: groupA.depth,
        roots: { A: groupA.root.toString(), B: groupB.root.toString(), C: groupC.root.toString(), outsider: outsiderGroup.root.toString() },
        scopes: { A: scopeA.toString(), B: scopeB.toString(), C: scopeC.toString() },
        members: members.map(String),
        expectedTallyA: expectedTally.map(String),
        proofIndex,
        proofsFlat: flat
    }

    mkdirSync(dirname(OUT_FILE), { recursive: true })
    writeFileSync(OUT_FILE, `${JSON.stringify(fixture, null, 2)}\n`, "utf8")

    console.log(`proofs written : ${flat.length / STRIDE} blocks (${flat.length} values)`)
    console.log(`expected tally : [${expectedTally.join(", ")}]`)
    console.log(`wrote          : ${OUT_FILE}`)

    // snarkjs keeps handles open; exit explicitly so the process terminates.
    process.exit(0)
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
