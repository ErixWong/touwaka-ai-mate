import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import pluginOxlint from 'eslint-plugin-oxlint'
import pluginVueI18n from '@intlify/eslint-plugin-vue-i18n'

// To allow more languages other than `ts` in `.vue` files, uncomment the following lines:
// import { configureVueProject } from '@vue/eslint-config-typescript'
// configureVueProject({ scriptLangs: ['ts', 'tsx'] })
// More info at https://github.com/vuejs/eslint-config-typescript/#advanced-setup

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{vue,ts,mts,tsx}'],
  },

  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**']),

  ...pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  // i18n 检查配置
  {
    name: 'app/i18n',
    plugins: {
      '@intlify/vue-i18n': pluginVueI18n,
    },
    rules: {
      // 检测缺失的翻译 key - 只检查 $t() 调用，不检查 locale 文件内容
      '@intlify/vue-i18n/no-missing-keys': 'off',
      // 检测未使用的翻译 key
      '@intlify/vue-i18n/no-unused-keys': 'off',
      // 禁止硬编码文本（中文）
      '@intlify/vue-i18n/no-raw-text': ['warn', {
        ignorePattern: '^[a-zA-Z0-9\s\\p{P}]*$', // 忽略纯英文数字
        ignoreText: [' ', '  ', '\n', '...', '→', '←', '↑', '↓'],
      }],
    },
  },

  ...pluginOxlint.buildFromOxlintConfigFile('.oxlintrc.json'),
)
