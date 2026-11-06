import { onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, type User } from 'firebase/auth'
import { ref } from 'vue'
import { auth } from '@/firebase'

const user = ref<User | null>(null)

// Resolves once Firebase has restored (or not) the persisted session.
const ready = new Promise<void>((resolve) => {
  onAuthStateChanged(auth, (u) => {
    user.value = u
    resolve()
  })
})

export function useAuth() {
  return {
    user,
    ready,
    signIn: (email: string, password: string) => signInWithEmailAndPassword(auth, email, password),
    signUp: (email: string, password: string) => createUserWithEmailAndPassword(auth, email, password),
    signOut: () => signOut(auth),
  }
}
