// Mock chrome API globals for any test that needs them
globalThis.chrome = {
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
    },
  },
};
