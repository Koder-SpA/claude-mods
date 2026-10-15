import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  ExplorerSection,
  Inventory,
  InventoryPlugin,
  InventoryServer,
  InventorySkill,
} from '../types'

// The inventory band: three pressable counters above the prompt. Pressing one
// lists what the session actually has (skills, MCP servers, plugins); pressing
// a server or a plugin row opens its own tools or skills.

const sectionAtom = atom({ plugin: 'cost-dashboard', key: 'section' } as const, null)
const itemAtom = atom({ plugin: 'cost-dashboard', key: 'item' } as const, null)
const pageAtom = atom({ plugin: 'cost-dashboard', key: 'page' } as const, 0)
const inventoryAtom = atom({ plugin: 'cost-dashboard', key: 'inventory' } as const, null)

const PAGE_ROWS = 8
const STALE_MS = 60_000

function shortToolName(wire: string): string {
  if (!wire.startsWith('mcp__')) return wire
  const rest = wire.slice('mcp__'.length)
  const sep = rest.indexOf('__')
  return sep === -1 ? rest : rest.slice(sep + 2)
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name)
}

// What an opened row holds: a server's tools, a plugin's skills, nothing else.
function childNames(
  inventory: Inventory | null,
  section: ExplorerSection | null,
  name: string,
): string[] {
  if (section === 'mcp') return inventory?.servers.find(one => one.name === name)?.tools ?? []
  if (section === 'plugins') return inventory?.plugins.find(one => one.name === name)?.skills ?? []
  return []
}

async function readJson($: EngineInterface, path: string): Promise<Record<string, unknown> | null> {
  try {
    const text = await $.fs.read(path)
    const data = JSON.parse(text)
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  } catch {
    return null
  }
}

async function settingsPaths($: EngineInterface): Promise<string[]> {
  const paths: string[] = []
  let configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (!configDir) {
    const home = await $.env.get('HOME')
    if (home) configDir = `${home}/.claude`
  }
  if (configDir) paths.push(`${configDir}/settings.json`)
  // Project settings last: they turn plugins on and off over the global ones.
  paths.push('.claude/settings.json', '.claude/settings.local.json')
  return paths
}

async function gatherPlugins(
  $: EngineInterface,
  skills: InventorySkill[],
): Promise<InventoryPlugin[]> {
  const keys = new Set<string>()
  for (const path of await settingsPaths($)) {
    const settings = await readJson($, path)
    const enabled = settings?.enabledPlugins
    if (!enabled || typeof enabled !== 'object') continue
    for (const [key, isOn] of Object.entries(enabled as Record<string, unknown>)) {
      if (isOn) keys.add(key)
      else keys.delete(key)
    }
  }

  const plugins = new Map<string, InventoryPlugin>()
  const put = (name: string, marketplace?: string): InventoryPlugin => {
    const held = plugins.get(name) ?? { name, marketplace, skills: [] }
    if (marketplace) held.marketplace = marketplace
    plugins.set(name, held)
    return held
  }
  for (const key of keys) {
    const [name, marketplace] = key.split('@')
    if (name) put(name, marketplace)
  }
  // A plugin whose skills the context lists is loaded, whatever the settings say.
  for (const skill of skills) {
    if (!skill.pluginName) continue
    put(skill.pluginName).skills.push(skill.name)
  }
  return [...plugins.values()].sort(byName)
}

async function gather($: EngineInterface): Promise<Inventory> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const breakdown = usage.context.breakdown

  const skills: InventorySkill[] = (breakdown?.skills?.skillFrontmatter ?? [])
    .map(one => ({ name: one.name, source: String(one.source), pluginName: one.pluginName }))
    .sort(byName)

  const servers = new Map<string, InventoryServer>()
  for (const tool of breakdown?.mcpTools ?? []) {
    const held = servers.get(tool.serverName) ?? { name: tool.serverName, tools: [], tokens: 0 }
    held.tools.push(shortToolName(tool.name))
    held.tokens += tool.tokens
    servers.set(tool.serverName, held)
  }
  for (const server of servers.values()) server.tools.sort((a, b) => a.localeCompare(b))

  return {
    skills,
    servers: [...servers.values()].sort(byName),
    plugins: await gatherPlugins($, skills),
    readAt: Date.now(),
  }
}

async function refresh($: EngineInterface): Promise<Inventory | null> {
  try {
    const inventory = await gather($)
    await update($, inventoryAtom, () => inventory)
    return inventory
  } catch {
    return null
  }
}

async function refreshIfStale($: EngineInterface): Promise<void> {
  const held = await read($, inventoryAtom)
  if (held && Date.now() - held.readAt < STALE_MS) return
  await refresh($)
}

async function openSection($: EngineInterface, section: ExplorerSection): Promise<void> {
  const open = await read($, sectionAtom)
  await update($, sectionAtom, () => (open === section ? null : section))
  await update($, itemAtom, () => null)
  await update($, pageAtom, () => 0)
  await refreshIfStale($)
}

async function openItem($: EngineInterface, name: string): Promise<void> {
  const held = await read($, itemAtom)
  await update($, itemAtom, () => (held === name ? null : name))
  await update($, pageAtom, () => 0)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'inventory',
      description: 'List the skills, MCP servers and plugins this session has',
    })
    void refresh($)

    return next(e)
  })

  on('command.run', { command: 'inventory' }, async $ => {
    const inventory = (await refresh($)) ?? (await read($, inventoryAtom))
    await update($, sectionAtom, () => 'skills')
    await update($, itemAtom, () => null)
    await update($, pageAtom, () => 0)
    if (!inventory) return { text: 'Could not read the session inventory.' }

    return {
      text:
        `Inventory band open. Skills ${inventory.skills.length}, ` +
        `MCP ${inventory.servers.length}, Plugins ${inventory.plugins.length}. ` +
        'Press Skills, MCP or Plugins above the prompt to switch lists.',
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // A survey owns the band while it is up; yield to it.
    if (e.props.hasSurvey) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const inventory = await read($, inventoryAtom)
    const section = await read($, sectionAtom)
    const item = await read($, itemAtom)
    const page = await read($, pageAtom)

    const counts = {
      skills: inventory?.skills.length ?? 0,
      mcp: inventory?.servers.length ?? 0,
      plugins: inventory?.plugins.length ?? 0,
    }

    // One row of rows for the open section, paged so the band stays small.
    const rows: { key: string; label: string; detail?: string; open?: boolean }[] = []
    if (section === 'skills') {
      for (const skill of inventory?.skills ?? []) {
        rows.push({
          key: `skill:${skill.name}`,
          label: skill.name,
          detail: skill.pluginName ? `${skill.source} · ${skill.pluginName}` : skill.source,
        })
      }
    } else if (section === 'mcp') {
      for (const server of inventory?.servers ?? []) {
        rows.push({
          key: `server:${server.name}`,
          label: server.name,
          detail: `${server.tools.length} tools`,
          open: item === server.name,
        })
      }
    } else if (section === 'plugins') {
      for (const plugin of inventory?.plugins ?? []) {
        rows.push({
          key: `plugin:${plugin.name}`,
          label: plugin.name,
          detail: plugin.marketplace
            ? `${plugin.marketplace} · ${plugin.skills.length} skills`
            : `${plugin.skills.length} skills`,
          open: item === plugin.name,
        })
      }
    }

    // Header, the "more" row and the open item's children all share the band's
    // rows, so the page is what maxRows spares, never more than PAGE_ROWS.
    const openChildren = item === null ? 0 : childNames(inventory, section, item).length
    const spare = Math.max(1, (e.props.maxRows ?? 12) - 3 - openChildren)
    const perPage = Math.min(PAGE_ROWS, spare)

    const pages = Math.max(1, Math.ceil(rows.length / perPage))
    const atPage = Math.min(page, pages - 1)
    const shown = rows.slice(atPage * perPage, atPage * perPage + perPage)

    return (
      <Box flexDirection="column">
        <Box>
          <Button
            key="skills"
            hotkey="s"
            variant={section === 'skills' ? 'primary' : undefined}
            onPress={() => openSection($, 'skills')}
          >
            Skills {String(counts.skills)}
          </Button>
          <Text> </Text>
          <Button
            key="mcp"
            hotkey="m"
            variant={section === 'mcp' ? 'primary' : undefined}
            onPress={() => openSection($, 'mcp')}
          >
            MCP {String(counts.mcp)}
          </Button>
          <Text> </Text>
          <Button
            key="plugins"
            hotkey="p"
            variant={section === 'plugins' ? 'primary' : undefined}
            onPress={() => openSection($, 'plugins')}
          >
            Plugins {String(counts.plugins)}
          </Button>
          <Text> </Text>
          <Button key="refresh" plain dimColor onPress={() => refresh($)}>
            ↻
          </Button>
          {section !== null && <Text> </Text>}
          {section !== null && (
            <Button
              key="close"
              plain
              dimColor
              role="dismiss"
              onPress={() => openSection($, section)}
            >
              close
            </Button>
          )}
        </Box>

        {section !== null && rows.length === 0 && (
          <Text dimColor>{inventory ? 'Nothing here.' : 'Reading the session…'}</Text>
        )}

        {section !== null &&
          shown.map(row => (
            <Box key={`row:${row.key}`} flexDirection="column">
              <Box>
                {section === 'skills' ? (
                  <Text>· {row.label} </Text>
                ) : (
                  <Button key={row.key} plain onPress={() => openItem($, row.label)}>
                    {row.open ? '▾ ' : '▸ '}
                    {row.label}{' '}
                  </Button>
                )}
                {row.detail !== undefined && <Text dimColor>{row.detail}</Text>}
              </Box>
              {row.open &&
                childNames(inventory, section, row.label).map(child => (
                  <Text key={`child:${row.key}:${child}`} dimColor>
                    {'    '}
                    {child}
                  </Text>
                ))}
            </Box>
          ))}

        {section !== null && pages > 1 && (
          <Box>
            <Button key="more" plain dimColor onPress={() => update($, pageAtom, n => (n + 1) % pages)}>
              more
            </Button>
            <Text dimColor>
              {' '}
              {String(atPage + 1)}/{String(pages)}
            </Text>
          </Box>
        )}
      </Box>
    )
  })
}
