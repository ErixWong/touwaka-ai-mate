function stringifyToolResultForMessage(result) {
  if (typeof result === 'string') return result;

  const seen = new WeakSet();

  try {
    return JSON.stringify(result, (_key, value) => {
      if (typeof value === 'bigint') {
        return value.toString();
      }

      if (value && typeof value === 'object') {
        if (seen.has(value)) {
          return '[circular]';
        }
        seen.add(value);
      }

      return value;
    });
  } catch (error) {
    return JSON.stringify({
      success: false,
      error: `Tool result serialization failed: ${error.message}`,
    });
  }
}

export {
  stringifyToolResultForMessage,
};

export default {
  stringifyToolResultForMessage,
};
