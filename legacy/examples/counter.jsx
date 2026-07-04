// scripts/build.mjs 向けのインタラクティブなデモ。ハンドラ (Plan 001) を
// 使う最初の例:テキストマーカー、derived、クリックハンドラのみで
// 条件分岐・リストは使わない。
export function Counter() {
	const count = signal(0);
	const doubled = derived(() => count() * 2);
	return (
		<div>
			<p>
				count: {count()} / doubled: {doubled()}
			</p>
			<button type="button" onClick={() => count(count() + 1)}>
				increment
			</button>
		</div>
	);
}
