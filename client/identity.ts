import { Identity } from "@semaphore-protocol/core"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

/**
 * Local, gitignored identity storage.
 *
 * The file holds the Semaphore identity secret. `identity*.json` is in `.gitignore`,
 * so it is never committed, and nothing in this module ever puts the secret on the
 * wire - only `commitment` is meant to leave this machine (via `join`).
 */
export interface StoredIdentity {
    version: 1
    /** Public identity commitment (decimal string). Safe to publish. */
    commitment: string
    /** base64 encoded EdDSA private key. NEVER send this anywhere. */
    secret: string
}

/** Creates a brand new Semaphore Identity using local randomness and persists it. */
export function keygen(path: string): Identity {
    if (existsSync(path)) {
        throw new Error(`Refusing to overwrite existing identity file: ${path}`)
    }
    const identity = new Identity() // random private key, generated locally
    saveIdentity(path, identity)
    return identity
}

export function saveIdentity(path: string, identity: Identity): void {
    const stored: StoredIdentity = {
        version: 1,
        commitment: identity.commitment.toString(),
        secret: identity.export()
    }
    mkdirSync(dirname(resolve(path)), { recursive: true })
    writeFileSync(path, `${JSON.stringify(stored, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
}

export function loadIdentity(path: string): Identity {
    if (!existsSync(path)) {
        throw new Error(`Identity file not found: ${path}. Run \`keygen\` first.`)
    }
    const stored = JSON.parse(readFileSync(path, "utf8")) as StoredIdentity
    if (stored.version !== 1 || typeof stored.secret !== "string") {
        throw new Error(`Unrecognised identity file format: ${path}`)
    }
    return Identity.import(stored.secret)
}

/**
 * The single line `keygen` prints to stdout: just the commitment.
 * Everything else goes to stderr so the commitment can be piped/handled safely.
 */
export function commitmentLine(identity: Identity): string {
    return identity.commitment.toString()
}
