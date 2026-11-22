export { BrandLogo, type BrandLogoProps } from "./components/brand-logos"
export {
  FeaturedShowcase,
  type FeaturedShowcaseProps,
} from "./components/featured-showcase"
export { PluginsView, type PluginsViewProps } from "./components/plugins-view"

export {
  fetchPluginsState,
  pluginsQueryKeys,
  pluginsQueryOptions,
  prefetchPluginsState,
  setFeaturedPlugin,
  togglePluginInstall,
  toggleSkillEnabled,
} from "./api/plugins-api"

export {
  usePluginsState,
  usePrefetchPlugins,
  useSetFeaturedPlugin,
  useTogglePluginInstall,
  useToggleSkill,
} from "./hooks/use-plugins"

export {
  CUSTOMIZE_NAV_ITEMS,
  DEFAULT_HERO_DESCRIPTIONS,
  OFFICIAL_CONNECTOR_NAMES,
  PLUGIN_CATEGORY_SECTIONS,
  filterPluginsByQuery,
  selectFeaturedShowcaseTiles,
  type OfficialConnectorName,
} from "./constants/catalog"

export {
  customizeTabSchema,
  memoryFileItemSchema,
  pluginCatalogItemSchema,
  pluginCategorySchema,
  pluginSearchInputSchema,
  pluginsStateSchema,
  skillItemSchema,
} from "./schemas"

export type {
  CustomizeTab,
  MemoryFileItem,
  PluginCatalogItem,
  PluginCategory,
  PluginsState,
  SkillItem,
} from "./types"
