export type Route =
    | { page: 'home' }
    | { page: 'chat'; conversationId: string | null };

export function parseRoute(pathname: string): Route {
    if (pathname === '/' || pathname === '/home') {
        return { page: 'home' };
    }

    if (pathname === '/chat' || pathname === '/chat/new') {
        return { page: 'chat', conversationId: null };
    }

    const chatMatch = pathname.match(/^\/chat\/(.+)$/);
    if (chatMatch && chatMatch[1]) {
        return { page: 'chat', conversationId: chatMatch[1] };
    }

    return { page: 'home' };
}

export function buildPath(route: Route): string {
    if (route.page === 'home') {
        return '/';
    }

    if (route.page === 'chat') {
        if (route.conversationId) {
            return `/chat/${route.conversationId}`;
        }
        return '/chat/new';
    }

    return '/';
}

export function navigateTo(route: Route): void {
    const path = buildPath(route);
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
}

export function replaceTo(route: Route): void {
    const path = buildPath(route);
    window.history.replaceState(null, '', path);
}