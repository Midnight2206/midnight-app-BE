export const wrapRouter = (router) => {
  const methods = ["get", "post", "put", "patch", "delete"];

  methods.forEach((method) => {
    const original = router[method];

    router[method] = (path, ...handlers) => {
      const wrappedHandlers = handlers.map((handler) => {
        if (typeof handler !== "function") return handler;

        return (req, res, next) => {
          Promise.resolve(handler(req, res, next)).catch(next);
        };
      });

      return original.call(router, path, ...wrappedHandlers);
    };
  });

  return router;
};
