// 要求ごとの入力を描画する100件一覧。データ読込みはloaderで一度だけ行う。
import { render } from 'irisout'
export function Users(input) {
  render(
    <main>
      <h1>Users</h1>
      <p class="summary">
        {input.count} users · {input.totalScore} total score · {input.admins} admins
      </p>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th class="num">Score</th>
          </tr>
        </thead>
        <tbody>
          {input.users.map((user) => (
            <tr key={user.id}>
              <td class="num">{user.id}</td>
              <td>{user.name}</td>
              <td>{user.email}</td>
              <td>{user.role}</td>
              <td class="num">{user.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="summary">Rendered per request for {input.agent}</p>
    </main>,
  )
}
