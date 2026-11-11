import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'tests/**/*.test.ts',
      ...(process.env.UNICODD_PRIVATE_TESTS === '1' ? ['private/testing/**/*.test.ts'] : []),
    ],
  },
})
