import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: () => import('./views/DashboardView.vue') },
    { path: '/prs', name: 'prs', component: () => import('./views/PullRequestsView.vue') },
    { path: '/slack', name: 'slack', component: () => import('./views/SlackView.vue') },
    { path: '/graph', name: 'graph', component: () => import('./views/GraphView.vue') },
    { path: '/jira', name: 'jira', component: () => import('./views/JiraView.vue') },
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
  ],
})
