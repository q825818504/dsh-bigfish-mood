/**
 * 本轮改造的回归测试（dsh-bigfish-mood 1.0.0）
 *
 * 覆盖四件事：
 *   1. 防重复挂载：同一个进程里 apply 两次，第二次必须什么都不挂
 *   2. 默认工作区模式：没有 config.json 时，默认绑「大肥鱼记忆开发」工作区
 *   3. 存储目录迁移：数据落在 <DSH_HOME>/bigfish-mood/，不碰 feiyu-mood
 *   4. timeline：落盘保留（记忆星图依赖），但有上限；/state 默认只返回最近 N 条
 *
 * 只读合成数据，不碰真实用户状态。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

const home = mkdtempSync(join(tmpdir(), 'bigfish-v1-'))
process.env.DSH_HOME = home
process.env.DSH_BIGFISH_MOOD_TIMELINE_MAX = '120'    // 落盘上限
process.env.DSH_BIGFISH_MOOD_STATE_TIMELINE = '50'   // /state 默认返回条数
const mod = await import('../lib/index.js')
const { apply, __测试: helpers } = mod
const P = helpers.路由前缀()

test.after(() => rmSync(home, { recursive: true, force: true }))

const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)) }

/** 最小假宿主：够 apply() 跑完即可 */
function fakeHost() {
  const routes = new Map()
  const effects = []
  const intervals = []
  const ctx = {
    agents: { list: () => [], roots: () => [] },
    effect(fn) { const off = fn(); if (typeof off === 'function') effects.push(off) },
    interval(fn) { intervals.push(fn); return () => {} },
    on: () => () => {},
    webServer: { register(route) { routes.set(route.path, route.handler); return () => {} } },
    llm: { listProviders: () => [], listModels: async () => [], async *stream() {} },
  }
  return { ctx, routes, effects, intervals }
}

function req(routes, path, body) {
  return new Promise(async (resolve) => {
    const r = Readable.from([JSON.stringify(body || {})])
    r.url = path
    r.method = body ? 'POST' : 'GET'
    let status = 0, out = ''
    await routes.get(path.split('?')[0])(r, {
      writeHead(code) { status = code },
      end(raw) { out = raw },
    })
    resolve({ status, body: JSON.parse(out) })
  })
}

// ── 1. 防重复挂载 ────────────────────────────────────────────────────────────
test('second apply() in the same process is refused and mounts nothing', () => {
  helpers.复位挂载()
  const first = fakeHost()
  apply(first.ctx)
  assert.ok(first.routes.size >= 10, '第一个实例应该注册了全部路由')

  const second = fakeHost()
  apply(second.ctx)
  assert.equal(second.routes.size, 0, '第二个实例不该注册任何路由')
  assert.equal(second.intervals.length, 0, '第二个实例不该启动 tick')

  helpers.复位挂载()
})

test('unload releases the guard so a real remount works', () => {
  helpers.复位挂载()
  const h = fakeHost()
  apply(h.ctx)
  const before = h.routes.size
  assert.ok(before > 0)
  // 触发 ctx.effect 注册的清理函数（apply 里注册的 teardown）
  for (const off of [...h.effects].reverse()) { try { off() } catch (e) {} }

  const again = fakeHost()
  apply(again.ctx)
  assert.ok(again.routes.size > 0, '卸载后应能重新挂载')
  helpers.复位挂载()
})

// ── 2. 默认工作区模式 ────────────────────────────────────────────────────────
test('default config binds the 大肥鱼记忆开发 workspace in workspace mode', () => {
  const cfg = helpers.读配置()
  assert.equal(cfg.模式, 'workspace')
  assert.equal(cfg.slots.length, 1)
  assert.equal(cfg.slots[0].工作区, '--D-~5927~80A5~9C7C~5F00~53D1--')
  assert.equal(cfg.slots[0].id, '--D-~5927~80A5~9C7C~5F00~53D1--')
  assert.equal(cfg.slots[0].label, '大肥鱼记忆开发')
})

test('workspace dir name encoding round-trips for the target path', () => {
  assert.equal(helpers.工作区目录名('D:\\大肥鱼开发'), '--D-~5927~80A5~9C7C~5F00~53D1--')
  assert.equal(helpers.工作区目录名('D:/大肥鱼开发'), '--D-~5927~80A5~9C7C~5F00~53D1--')
})

test('an explicit config keeps its own mode instead of the default', () => {
  const dir = join(home, 'bigfish-mood')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ 模式: 'session', slots: [{ id: 'x', sessions: ['s1'] }] }))
  const cfg = helpers.读配置()
  assert.equal(cfg.模式, 'session')
  assert.equal(cfg.slots[0].id, 'x')
  rmSync(join(dir, 'config.json'))
})

// ── 3. 存储目录 ──────────────────────────────────────────────────────────────
test('state is stored under <DSH_HOME>/bigfish-mood, not feiyu-mood', () => {
  assert.equal(helpers.库路径(), join(home, 'bigfish-mood', 'state.json'))
  assert.equal(helpers.存储目录(), join(home, 'bigfish-mood'))
  assert.ok(!existsSync(join(home, 'feiyu-mood')), '不该创建 feiyu-mood 目录')
})

test('route prefix is the bigfish one', () => {
  assert.equal(P, '/dsh-bigfish-mood')
})

// ── 4. timeline 契约（记忆星图依赖） ─────────────────────────────────────────
test('timeline entries keep at / mood / dims for the star map', () => {
  helpers.复位挂载()
  const h = fakeHost()
  apply(h.ctx)
  const s = helpers.normState({ mood: 70, dims: { happy: 3 } })
  const dims = Object.fromEntries(Object.keys(s.dims).map(k => [k, k === 'happy' ? 2 : 0]))
  helpers.applyDelta(s, { moodDelta: 6, dims, reason: 'fixture', confidence: 90 }, 0, false)
  const entry = s.timeline.at(-1)
  assert.ok(Number.isFinite(entry.at), 'at 必须是数字')
  assert.ok(Number.isFinite(entry.mood), 'mood 必须是数字')
  assert.equal(typeof entry.dims, 'object')
  assert.ok(Number.isFinite(entry.dims.happy), 'dims 里每根情绪必须是数字')
  helpers.复位挂载()
})

test('timeline is capped on disk but keeps the newest entries', () => {
  const s = helpers.normState({ mood: 70 })
  const dims = Object.fromEntries(Object.keys(s.dims).map(k => [k, 0]))
  for (let i = 0; i < 300; i++) {
    helpers.applyDelta(s, { moodDelta: 3, dims, reason: 'r' + i, confidence: 90 }, 0, false)
  }
  // DSH_BIGFISH_MOOD_TIMELINE_MAX=120
  assert.equal(s.timeline.length, 120, '应被裁到上限')
  assert.equal(s.timeline.at(-1).reason, 'r299', '保留的是最新的那条')
})

test('/state returns a bounded timeline but reports the real total', async () => {
  helpers.复位挂载()
  const h = fakeHost()
  apply(h.ctx)

  // 造一份带很多条 timeline 的状态，写进默认工作区那份
  const key = '--D-~5927~80A5~9C7C~5F00~53D1--'
  const s = helpers.normState({ mood: 70 })
  const dims = Object.fromEntries(Object.keys(s.dims).map(k => [k, 0]))
  for (let i = 0; i < 400; i++) {
    helpers.applyDelta(s, { moodDelta: 3, dims, reason: 'r' + i, confidence: 90 }, 0, false)
  }
  helpers.存一份(key, s)

  // 落盘上限 120，/state 默认返回 50
  const bounded = await req(h.routes, P + '/state')
  assert.equal(bounded.status, 200)
  assert.equal(bounded.body.timeline.length, 50, '默认只返回最近 50 条')
  assert.equal(bounded.body.timelineTotal, 120, 'total 报告磁盘上的真实条数')
  assert.equal(bounded.body.timeline.at(-1).reason, 'r399', '返回的是最新的那批')

  const full = await req(h.routes, P + '/state?timeline=all')
  assert.equal(full.body.timeline.length, full.body.timelineTotal, '?timeline=all 返回全量')

  helpers.复位挂载()
})

// ── 5. decay 守 floor ───────────────────────────────────────────────────────
test('decay respects moodFloor', () => {
  const start = Date.parse('2026-10-25T00:00:00Z')
  // 心情 100、基线 50、下限 80 —— 衰减不许把值拉到 80 以下
  const s = helpers.normState({ mood: 100, dims: {}, lastDecayAt: start, lastNotedMood: 100 })
  helpers.decay(s, 50, start + 24 * 60 * 60000, 12, 80)
  assert.ok(s.mood >= 80, '衰减后不得低于 moodFloor，实际 ' + s.mood)
  assert.ok(s.mood < 100, '仍然应该往基线回落')
})

test('decay with floor 0 behaves like before', () => {
  const start = Date.parse('2026-10-25T00:00:00Z')
  const s = helpers.normState({ mood: 100, dims: {}, lastDecayAt: start, lastNotedMood: 100 })
  helpers.decay(s, 50, start + 24 * 60 * 60000, 12, 0)
  assert.ok(s.mood > 50 && s.mood < 100)
})

// ── 6. normState 不再用「对方」改写磁盘上的 reason ───────────────────────────
test('reading state back does not rewrite pronouns to 对方', () => {
  const raw = { mood: 70, lastReason: '她说累了，我心里一紧', timeline: [] }
  const s = helpers.normState(raw)
  assert.equal(s.lastReason, '她说累了，我心里一紧', '不传 owner 时必须原样保留')
  assert.ok(!s.lastReason.includes('对方'))
})

test('normState still normalizes when an owner is explicitly given', () => {
  const raw = { mood: 70, lastReason: '她说累了', timeline: [] }
  const s = helpers.normState(raw, '主人')
  assert.equal(s.lastReason, '主人说累了')
})

// ── 7. 工作区模式端到端：一轮对话必须落进 timeline ───────────────────────────
test('workspace mode judges a real turn and writes a timeline entry', async () => {
  const WS = '--D-~5927~80A5~9C7C~5F00~53D1--'
  const sid = 'session-one'
  // 造出 DSH 的会话目录形状：<DSH_HOME>/sessions/<工作区>/<会话>/
  mkdirSync(join(home, 'sessions', WS, sid), { recursive: true })
  // 让 config.json 回到默认（工作区模式 + 默认工作区），并清掉前面用例留下的状态
  rmSync(join(home, 'bigfish-mood', 'config.json'), { force: true })
  rmSync(join(home, 'bigfish-mood', 'state.json'), { force: true })

  helpers.复位挂载()
  const routes = new Map()
  const effects = []
  const intervals = []
  const events = new Map()
  const judged = []

  const agent = {
    session: {
      id: sid,
      snapshotEvents: () => [
        { type: 'user/message', payload: { text: '今天写完了两章', source: { kind: 'user' } } },
        { type: 'assistant/message', payload: { text: '好厉害，我心里挺高兴的' } },
      ],
    },
    options: { provider: 'fake', model: 'fake' },
    ctx: {
      on(name, fn) { events.set(name, fn); return () => events.delete(name) },
      systemPrompt: { context: () => () => {} },
    },
  }

  const ctx = {
    agents: { list: () => [agent], roots: () => [agent] },
    effect(fn) { const off = fn(); if (typeof off === 'function') effects.push(off) },
    interval(fn) { intervals.push(fn); return () => {} },
    on: () => () => {},
    webServer: { register(r) { routes.set(r.path, r.handler); return () => {} } },
    llm: {
      listProviders: () => [],
      listModels: async () => [],
      async *stream(opts) {
        judged.push(opts)
        yield { type: 'text-delta', text: JSON.stringify({ moodDelta: 9, dims: { happy: 6 }, reason: '主人写完了两章', confidence: 92 }) }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
  }

  apply(ctx)
  // apply() 里的 tick() 会立刻挂上；但工作区扫描有 5 秒缓存（前面的用例扫过空目录），
  // 这里强制重扫一次，再手动 tick 让新会话被挂上。
  helpers.扫会话目录(true)
  for (const fn of intervals) fn()

  assert.ok(events.get('agent/turn-stopping'), '工作区里的会话应该被挂上 turn-stopping')

  events.get('agent/turn-stopping')()
  await flush()

  assert.equal(judged.length, 1, '应该发起了一次判断')
  const store = helpers.读库()
  const slot = store.moods[WS]
  assert.ok(slot, '工作区那份心情应该被创建，实际键: ' + Object.keys(store.moods).join(','))
  assert.equal(slot.timeline.length, 1, 'timeline 应该有一条')
  const entry = slot.timeline[0]
  assert.equal(entry.mood, 73, 'mood 70 + round(9/3)=3')
  assert.equal(entry.reason, '主人写完了两章')
  assert.ok(Number.isFinite(entry.at) && Number.isFinite(entry.mood) && entry.dims, '记忆星图要的三个字段都在')

  helpers.复位挂载()
  rmSync(join(home, 'sessions'), { recursive: true, force: true })
})
