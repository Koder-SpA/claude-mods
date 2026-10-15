import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'cost-dashboard'

const BAND = {
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
}

test('the band draws a pressable counter for skills, MCP and plugins', async ($, on) => {
  mock.clock(on)
  mock.env(on, { HOME: '/tmp/cost-dashboard-test-home' })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })

  expect((await ui.find({ key: 'skills' }))?.text).toMatch(/Skills/)
  expect((await ui.find({ key: 'mcp' }))?.text).toMatch(/MCP/)
  expect((await ui.find({ key: 'plugins' }))?.text).toMatch(/Plugins/)
  expect(await ui.find({ key: 'refresh' })).toBeDefined()
  // Nothing is open yet, so the band holds no list and no dismiss control.
  expect(await ui.find({ key: 'close' })).toBeUndefined()

  await ui.unmount()
})

test('pressing a counter opens its list and pressing close puts it away', async ($, on) => {
  mock.clock(on)
  mock.env(on, { HOME: '/tmp/cost-dashboard-test-home' })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })

  await ui.press({ key: 'mcp' })
  expect(await ui.find({ key: 'close' })).toBeDefined()

  await ui.press({ key: 'close' })
  expect(await ui.find({ key: 'close' })).toBeUndefined()

  await ui.unmount()
})

test('the band yields the row while a survey holds it', async ($, on) => {
  mock.clock(on)
  mock.env(on, { HOME: '/tmp/cost-dashboard-test-home' })
  // The survey's own render sits beneath the plugin; the band yields to it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    return $.ui.resolve(e).Text({ children: 'survey' })
  })

  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { ...BAND.props, hasSurvey: true },
  })

  expect(await ui.find({ key: 'skills' })).toBeUndefined()

  await ui.unmount()
})

test('pressing mcp twice returns the band to the closed state', async ($, on) => {
  mock.clock(on)
  mock.env(on, { HOME: '/tmp/cost-dashboard-test-home' })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })

  await ui.press({ key: 'mcp' })
  expect(await ui.find({ key: 'close' })).toBeDefined()

  await ui.press({ key: 'mcp' })
  expect(await ui.find({ key: 'close' })).toBeUndefined()

  await ui.unmount()
})
