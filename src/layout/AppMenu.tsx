"use client";

import React from 'react';
import AppMenuitem from './AppMenuitem';
import { MenuProvider } from './context/menucontext';
import { AppMenuItem } from '@/types';

const AppMenu = () => {
    async function logout() {
        await fetch('/api/bff/auth/logout', { method: 'POST' });
        window.location.assign('/login');
    }

    const model: AppMenuItem[] = [
        {
            label: 'Clean Pay',
            items: [
                { label: 'Кабинет', icon: 'pi pi-fw pi-home', to: '/cabinet' },
                { label: 'Тарифы', icon: 'pi pi-fw pi-tags', to: '/tariffs' },
                { label: 'Оплата', icon: 'pi pi-fw pi-credit-card', to: '/payment' },
                { label: 'Продление', icon: 'pi pi-fw pi-refresh', to: '/extend' }
            ]
        },
        {
            label: 'Аккаунт',
            items: [
                { label: 'Профиль', icon: 'pi pi-fw pi-user', to: '/profile' },
                { label: 'Подтвердить e-mail', icon: 'pi pi-fw pi-envelope', to: '/verify-email' },
                { label: 'Связать аккаунт', icon: 'pi pi-fw pi-link', to: '/link-account' }
            ]
        },
        {
            label: 'Помощь',
            items: [
                { label: 'Поддержка', icon: 'pi pi-fw pi-question-circle', to: '/support' },
                {
                    label: 'Выйти',
                    icon: 'pi pi-fw pi-sign-out',
                    command: ({ originalEvent }) => {
                        originalEvent.preventDefault();
                        void logout();
                    }
                },
                { label: 'Регистрация', icon: 'pi pi-fw pi-user-plus', to: '/register' }
            ]
        }
    ];

    return (
        <MenuProvider>
            <ul className="layout-menu">
                {model.map((item, i) => {
                    return !item?.seperator ? <AppMenuitem item={item} root={true} index={i} key={item.label} /> : <li className="menu-separator"></li>;
                })}

                <li className="mt-4 px-3 py-3 border-round surface-ground">
                    <div className="text-900 font-medium mb-2">CleanVPN</div>
                    <div className="text-600 text-sm line-height-3">Оплата, продление и профиль в едином web-кабинете.</div>
                </li>
            </ul>
        </MenuProvider>
    );
};

export default AppMenu;
