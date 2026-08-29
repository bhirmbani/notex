import { describe, expect, it } from 'vitest'

// A plain .mjs build script — TypeScript resolves it through `allowJs` and infers the
// shapes, so the transform stays covered even though it lives outside src/.
import { DEPLOY_ENVS, applyDeployEnv, buildEnv } from '../../scripts/deploy-env.mjs'

// Shaped like what Nitro's cloudflare-module preset writes to
// .output/server/wrangler.json: production's values, which the deploy scripts then
// retarget per environment.
function generatedConfig() {
  return {
    name: 'notex',
    main: 'index.mjs',
    compatibility_date: '2025-09-15',
    compatibility_flags: ['nodejs_compat'],
    no_bundle: true,
    d1_databases: [
      {
        binding: 'DB',
        database_name: 'notex',
        database_id: '85b25fb8-aa70-46ce-9290-ea414288e99b',
        remote: false,
      },
    ],
  }
}

describe('applyDeployEnv', () => {
  it('retargets the worker name and database at the dev environment', () => {
    const config = applyDeployEnv(generatedConfig(), 'dev')

    expect(config.name).toBe('notex-dev')
    expect(config.d1_databases).toEqual([
      {
        binding: 'DB',
        database_name: 'notex-dev',
        database_id: DEPLOY_ENVS.dev.databaseId,
        remote: false,
      },
    ])
  })

  it('replaces d1_databases rather than appending to it', () => {
    // Two entries bound to "DB" is a duplicate-binding error in Wrangler, and is what a
    // defu-style merge of the same key would produce.
    const config = applyDeployEnv(generatedConfig(), 'dev')

    expect(config.d1_databases).toHaveLength(1)
  })

  it('sets BETTER_AUTH_URL so the deploy does not strip it from the Worker', () => {
    expect(applyDeployEnv(generatedConfig(), 'dev').vars).toEqual({
      BETTER_AUTH_URL: 'https://notex-dev.bm.workers.dev',
    })
    expect(applyDeployEnv(generatedConfig(), 'prod').vars).toEqual({
      BETTER_AUTH_URL: 'https://notex.bm.workers.dev',
    })
  })

  it('does not set VITE_APP_URL as a Worker var — it is build-time only', () => {
    expect(applyDeployEnv(generatedConfig(), 'dev').vars).not.toHaveProperty(
      'VITE_APP_URL',
    )
  })

  it('carries the rest of the generated config through untouched', () => {
    const config = applyDeployEnv(generatedConfig(), 'dev')

    expect(config.compatibility_date).toBe('2025-09-15')
    expect(config.compatibility_flags).toEqual(['nodejs_compat'])
    expect(config.no_bundle).toBe(true)
    expect(config.main).toBe('index.mjs')
  })

  it('leaves the input config unmutated', () => {
    const input = generatedConfig()
    applyDeployEnv(input, 'dev')

    expect(input.name).toBe('notex')
    expect(input.d1_databases[0]?.database_name).toBe('notex')
  })

  it('rejects an unknown environment instead of deploying a half-configured worker', () => {
    expect(() => applyDeployEnv(generatedConfig(), 'staging')).toThrow(/staging/)
  })
})

describe('buildEnv', () => {
  it('supplies the origin Vite inlines into the client bundle', () => {
    expect(buildEnv('dev').VITE_APP_URL).toBe('https://notex-dev.bm.workers.dev')
    expect(buildEnv('prod').VITE_APP_URL).toBe('https://notex.bm.workers.dev')
  })

  it('tags the build with the environment it was built for', () => {
    expect(buildEnv('dev').VITE_APP_ENV).toBe('dev')
    expect(buildEnv('prod').VITE_APP_ENV).toBe('prod')
  })

  it('resolves a commit sha for the deployed UI to show', () => {
    expect(buildEnv('dev').VITE_COMMIT_SHA).toMatch(/^[0-9a-f]{7,40}$/)
  })

  it('prefers a CI-provided sha over local git history', () => {
    const original = process.env.GITHUB_SHA
    process.env.GITHUB_SHA = 'abcdef0123456789'
    try {
      expect(buildEnv('dev').VITE_COMMIT_SHA).toBe('abcdef0')
    } finally {
      if (original === undefined) delete process.env.GITHUB_SHA
      else process.env.GITHUB_SHA = original
    }
  })

  it('rejects an unknown environment', () => {
    expect(() => buildEnv('staging')).toThrow(/staging/)
  })
})
