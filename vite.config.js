import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import createVitePlugins from './vite/plugins'

// 后端接口基础地址（开发环境代理目标）
// 生产环境部署时，前端静态资源会直接部署到 Nginx 等服务器，
// 通过 Nginx 反向代理将 /prod-api 转发到实际的后端服务
const baseUrl = 'http://localhost:8080'

/**
 * Vite 配置主入口
 *
 * @param {Object} args
 * @param {string} args.mode    - 环境模式：development（开发）、production（生产）
 * @param {string} args.command - 执行命令：serve（开发服务器）、build（打包构建）
 *
 * 配合 loadEnv 加载对应环境的 .env 文件变量：
 *   .env                  -> 所有环境都加载（通用配置）
 *   .env.development      -> 开发环境专用
 *   .env.production       -> 生产环境专用
 */
export default defineConfig(({ mode, command }) => {
  // 加载当前 mode 对应的环境变量文件（如 .env.development、.env.production）
  const env = loadEnv(mode, process.cwd())
  // VITE_APP_ENV：自定义标识，用于区分当前应用运行环境
  const { VITE_APP_ENV } = env

  return {
    /**
     * 部署应用的基础路径（base）
     * 作用：所有构建产物和静态资源引用的前缀路径
     *
     * 场景说明：
     *   - 根路径部署：https://www.example.com/         -> 设置为 '/'
     *   - 子路径部署：https://www.example.com/admin/    -> 设置为 '/admin/'
     *
     * ⚠️ 注意：开发环境即使设置子路径，浏览器访问时仍需使用根路径
     *   生产环境打包后，需要通过 Nginx 配合 location /admin 部署
     */
    base: VITE_APP_ENV === 'production' ? '/' : '/',

    // Vite 插件配置（从 vite/plugins/index.js 导入，包含自动导入、Vue 宏等插件）
    // 第二个参数标识是否为构建模式，用于区分开发/生产需要加载哪些插件
    plugins: createVitePlugins(env, command === 'build'),

    // 模块解析配置
    resolve: {
      /**
       * 路径别名
       *   '~' -> 项目根目录（可引用 public、vite 等非 src 目录资源）
       *   '@' -> src 目录（日常开发引用组件、工具类使用）
       * 示例：import request from '@/utils/request'
       */
      alias: {
        '~': path.resolve(__dirname, './'),
        '@': path.resolve(__dirname, './src')
      },
      // 自动补全的扩展名顺序（引用文件时可省略扩展名，如 import App from './App'）
      extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.vue']
    },

    /**
     * 生产构建配置（仅执行 vite build 命令时生效）
     */
    build: {
      /**
       * Source Map 配置
       *   production 构建：关闭（体积小、性能好，错误会显示压缩后的行号）
       *   development   ：开启 inline（内联到产物中，方便浏览器调试）
       *
       * 如果生产环境需要排查问题，可临时改为 'hidden'（不影响原 map，但可上传到 Sentry 等工具）
       */
      sourcemap: command === 'build' ? false : 'inline',

      // 输出目录：构建产物输出到项目根目录的 dist 文件夹（可被 Nginx 直接托管）
      outDir: 'dist',

      // 资源子目录：dist 下存放静态资源（图片、字体等非 JS/CSS）的文件夹
      assetsDir: 'assets',

      // chunk 体积警告阈值（单位 KB），超过 2000KB 时会在控制台给出警告
      // 若主包体积较大，可考虑开启组件懒加载或配置 manualChunks
      chunkSizeWarningLimit: 2000,

      /**
       * Rollup 输出配置
       * 使用 hash 值，文件名在文件内容变化时才会改变
       * 好处：配合 HTTP 缓存（Cache-Control: max-age），用户访问时直接命中缓存，提升加载速度
       */
      rollupOptions: {
        output: {
          // 异步加载的 chunk 文件（路由懒加载、动态 import 产生的分包）
          chunkFileNames: 'static/js/[name]-[hash].js',
          // 入口文件（main.js / App.vue 打包后的主文件）
          entryFileNames: 'static/js/[name]-[hash].js',
          // 静态资源（图片、字体、CSS 等，按扩展名分类存放）
          assetFileNames: 'static/[ext]/[name]-[hash].[ext]'
        }
      }
    },

    /**
     * 开发服务器配置（仅 vite serve 时生效，生产构建无此概念）
     * 解决本地开发时跨域问题：浏览器 -> Vite Dev Server -> 真实后端
     */
    server: {
      // 本地启动端口（浏览器访问地址 http://localhost:80）
      port: 80,
      // 监听所有地址（host: true 等价于 0.0.0.0），方便局域网其他设备访问调试
      host: true,
      // 启动后自动在默认浏览器打开页面
      open: true,

      /**
       * API 代理配置
       * 开发环境下前端请求 /dev-api/xxx 会被代理到 http://localhost:8080/xxx
       * rewrite 会把 /dev-api 前缀替换掉，后端实际接收的是 /xxx
       *
       * 生产环境等效方案：在 Nginx 中配置反向代理
       *   location /prod-api/ {
       *     proxy_pass http://backend-server:8080/;
       *   }
       */
      proxy: {
        // 业务接口代理（对应 .env.development 中的 VITE_APP_BASE_API=/dev-api）
        '/dev-api': {
          target: baseUrl,
          changeOrigin: true,                           // 修改请求头中的 Origin，避免后端 CORS 拦截
          rewrite: (p) => p.replace(/^\/dev-api/, '')   // 去掉 /dev-api 前缀后转发
        },
        // SpringDoc / Swagger 接口文档代理（前端在线预览 OpenAPI 规范用）
        '^/v3/api-docs/(.*)': {
          target: baseUrl,
          changeOrigin: true,
        }
      }
    },

    /**
     * PostCSS 配置
     * 自动移除 CSS 文件中的 @charset 规则
     * 原因：CSS 文件通过 HTTP 传输时 Content-Type 已经声明了编码，
     *       @charset 是冗余的，且当多个 CSS 合并时可能导致打包冲突
     */
    css: {
      postcss: {
        plugins: [
          {
            postcssPlugin: 'internal:charset-removal',
            AtRule: {
              charset: (atRule) => {
                if (atRule.name === 'charset') {
                  atRule.remove()
                }
              }
            }
          }
        ]
      }
    }
  }
})