# instance-context

compile-time inlineされるcomponent treeで、provider値を現在のrootまたはstructural unitの
字句範囲へ接続する。

## Requirements

### Requirement: context key and provider

トップレベルの`const Theme = createContext(defaultValue)`をcontext keyとして受理し、
component変数ゾーンの`provideContext(Theme, value)`をそのcomponent subtreeのproviderと
して登録しなければならない(SHALL)。providerがないconsumerはdefaultValueへ解決する。

#### Scenario: default consumer

- **WHEN** `useContext(Theme)`に対応するproviderがない
- **THEN** consumerはcontextのdefaultValueへ解決される

### Requirement: instance ownership

`useContext(Theme)`は最も近いproviderの値式へ静的に置換されなければならない(SHALL)。値式が
root signalまたはstructural unit local signalを読む場合、そのowner instanceの通常の更新
依存へ合流しなければならない(SHALL)。Map、汎用provider runtime、module共有mutable stateを
生成してはならない(SHALL)。

#### Scenario: item-local context

- **WHEN** keyed list itemがlocal signalをprovider値として持ち、そのinline childがconsumerを持つ
- **THEN** 各item factoryが自身の値を表示し、他itemの値を共有しない

### Requirement: output boundary

context APIを使わないcomponentの生成物にcontext key/provider/consumer専用runtimeコードを
出力してはならない(SHALL)。providerが構造unitの字句範囲外を参照する場合はscope limitで
拒否しなければならない(SHALL)。

#### Scenario: unused output

- **WHEN** authored sourceが`createContext`、`provideContext`、`useContext`を含まない
- **THEN** generated codeにcontext専用識別子やruntime importを含めない
