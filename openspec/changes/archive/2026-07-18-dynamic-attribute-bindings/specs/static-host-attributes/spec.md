# static-host-attributes delta

## REMOVED Requirements

### Requirement: 式コンテナ属性値の拒否
**Reason**: ADR-0012 により式コンテナ値の host 属性は動的属性バインディング
として受理するようになった(UNRESOLVED 02/03 の解消)。
**Migration**: 受理・反映の要件は新 capability `dynamic-attribute-bindings`
が規定する。spread 属性・namespaced 名の拒否は本 spec の既存要件のまま
維持される。
