# tools

Repository tooling. `codegen/` turns `metadata/` into typed bindings.
`privacy-lint/` is a custom lint pass that fails the build when a service imports a
vault client it is not permitted to use, when a log statement carries a field marked
sensitive in `metadata/data/classification`, or when a request handler is missing a
purpose string.
