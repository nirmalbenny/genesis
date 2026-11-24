import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import AppsView from '@/views/AppsView.vue'
import BuildsView from '@/views/BuildsView.vue'
import ChooseView from '@/views/ChooseView.vue'
import Dashboard from '@/views/Dashboard.vue'
import SignIn from '@/views/SignIn.vue'
import SignUp from '@/views/SignUp.vue'
import RunView from '@/views/RunView.vue'
import VerifyEmail from '@/views/VerifyEmail.vue'
import Workspace from '@/views/Workspace.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/signin', component: SignIn, meta: { guest: true } },
    { path: '/signup', component: SignUp, meta: { guest: true } },
    { path: '/verify', component: VerifyEmail, meta: { unverified: true } },
    { path: '/', component: Dashboard },
    { path: '/apps', component: AppsView },
    { path: '/builds', component: BuildsView },
    { path: '/p/:id', component: Workspace },
    { path: '/run/:id', component: RunView },
    { path: '/choose/:id', component: ChooseView },
  ],
})

router.beforeEach(async (to) => {
  const { user, emailVerified, ready } = useAuth()
  await ready
  if (!user.value) return to.meta.guest ? true : '/signin'
  // Signed in: nothing is usable until the email address is verified.
  if (!emailVerified.value) return to.meta.unverified ? true : '/verify'
  if (to.meta.guest || to.meta.unverified) return '/'
})

export default router
