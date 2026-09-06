## MODIFIED Requirements

### Requirement: output boundary

onMountを使わないcomponentの生成物に、onMount専用のcleanup変数・配線・runtime importを
出力してはならない(SHALL)。構造unit内のonMountはunit factoryが所有し、root scopeの
inline childはroot instanceへ、list/conditional scopeのinline childは現在のunit factoryへ
静的に収集しなければならない(SHALL)。

#### Scenario: 未使用生成物に専用コードを出力しない

- **WHEN** componentと構造unitが`onMount`を含まない
- **THEN** 生成codeにonMount専用の識別子・配線が含まれない
