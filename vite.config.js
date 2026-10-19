import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// base './' 让构建产物用相对路径加载资源,适配 GitHub Pages 的 /仓库名/ 子路径部署
export default defineConfig({
  plugins: [vue()],
  base: './',
})
