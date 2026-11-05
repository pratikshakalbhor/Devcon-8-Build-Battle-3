import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Minimal `.env` loader (no extra dependency).
 * Values already present in `process.env` win over the file.
 */
export function loadEnv(path: string = resolve(process.cwd(), ".env")): void {
    if (!existsSync(path)) return

    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed === "" || trimmed.startsWith("#")) continue

        const eq = trimmed.indexOf("=")
        if (eq === -1) continue

        const key = trimmed.slice(0, eq).trim()
        let value = trimmed.slice(eq + 1).trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1)
        }
        if (process.env[key] === undefined) process.env[key] = value
    }
}

export function requiredEnv(name: string): string {
    const value = process.env[name]
    if (!value) {
        throw new Error(`Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`)
    }
    return value
}

export function optionalEnv(name: string, fallback: string): string {
    return process.env[name] ? (process.env[name] as string) : fallback
}
