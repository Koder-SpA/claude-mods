export type InventorySkill = {
  name: string
  source: string
  pluginName?: string
}

export type InventoryServer = {
  name: string
  tools: string[]
  tokens: number
}

export type InventoryPlugin = {
  name: string
  marketplace?: string
  skills: string[]
}

export type Inventory = {
  skills: InventorySkill[]
  servers: InventoryServer[]
  plugins: InventoryPlugin[]
  readAt: number
}

export type ExplorerSection = 'skills' | 'mcp' | 'plugins'

declare module 'claude-code' {
  interface PluginState {
    'cost-dashboard': {
      section: ExplorerSection | null
      item: string | null
      page: number
      inventory: Inventory | null
    }
  }
}
