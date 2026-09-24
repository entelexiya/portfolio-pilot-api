/**
 * Claude provider, over the official Anthropic SDK.
 *
 * Uses structured outputs so the response is schema-constrained at generation
 * time; `narrative.ts` still validates with zod afterwards.
 */

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { NarrativeSchema } from '../narrative-schema'
import { ProviderError, type NarrativeProvider } from './types'

const DEFAULT_MODEL = 'claude-opus-5'

export function createClaudeProvider(): NarrativeProvider {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new ProviderError('ANTHROPIC_API_KEY is not configured')
  }

  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL
  const client = new Anthropic({ apiKey })

  return {
    name: `claude:${model}`,
    async generateJson({ system, user }) {
      const response = await client.messages.parse({
        model,
        max_tokens: 16000,
        system,
        output_config: {
          effort: 'medium',
          format: zodOutputFormat(NarrativeSchema),
        },
        messages: [{ role: 'user', content: user }],
      })

      if (response.stop_reason === 'refusal') {
        throw new ProviderError('Claude declined the request')
      }
      if (!response.parsed_output) {
        throw new ProviderError('Claude returned no parseable output')
      }

      return response.parsed_output as unknown
    },
  }
}
