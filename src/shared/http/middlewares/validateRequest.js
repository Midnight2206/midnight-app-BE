function syncRequestPart(req, key, value) {
  if (value === undefined) return;

  const currentValue = req[key];
  if (
    currentValue &&
    value &&
    typeof currentValue === "object" &&
    typeof value === "object" &&
    !Array.isArray(currentValue) &&
    !Array.isArray(value)
  ) {
    Object.keys(currentValue).forEach((currentKey) => {
      delete currentValue[currentKey];
    });
    Object.assign(currentValue, value);
    return;
  }

  Object.defineProperty(req, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

export const validate =
  (schema) =>
  (req, res, next) => {
    const parsed = schema.parse({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    syncRequestPart(req, "body", parsed.body);
    syncRequestPart(req, "query", parsed.query);
    syncRequestPart(req, "params", parsed.params);

    next();
  };
