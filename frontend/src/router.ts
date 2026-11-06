import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import AppsView from '@/views/AppsView.vue'
import Dashboard from '@/views/Dashboard.vue'
import SignIn from '@/views/SignIn.vue'
import SignUp from '@/views/SignUp.vue'
import RunView from '@/views/RunView.vue'
import Workspace from '@/views/Workspace.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/signin', component: SignIn, meta: { guest: true } },
    { path: '/signup', component: SignUp, meta: { guest: true } },
    { path: '/', component: Dashboard },
    { path: '/apps', component: AppsView },
    { path: '/p/:id', component: Workspace },
    { path: '/run/:id', component: RunView },
  ],
})

router.beforeEach(async (to) => {
  const { user, ready } = useAuth()
  await ready
  if (!user.value && !to.meta.guest) return '/signin'
  if (user.value && to.meta.guest) return '/'
})

export default router
