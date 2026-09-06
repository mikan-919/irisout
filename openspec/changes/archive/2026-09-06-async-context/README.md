# async-context

非同期値を持つcontextを静的置換として受理する

## Requirements

### Requirement: async context value

The compiler SHALL accept top-level `createAsyncContext(defaultPromiseLike)`, allow
`provideContext` and `useContext` with the same key, and replace consumers with the authored
PromiseLike expression. It SHALL not await or schedule the value implicitly.

#### Scenario: authored resolution

- **WHEN** an effect calls `.then()` on an async context consumer
- **THEN** the generated effect contains the statically provided PromiseLike expression

### Requirement: async context output boundary

The compiler SHALL omit async context runtime objects, registries, and scheduler imports. It SHALL
leave Suspense, cancellation, SSR, and post-resolution DOM policy to authored code.

#### Scenario: no async context output

- **WHEN** a component does not author an async context
- **THEN** generated output contains no async context runtime machinery
