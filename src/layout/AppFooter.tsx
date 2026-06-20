/* eslint-disable @next/next/no-img-element */

import React from 'react';

const AppFooter = () => {
    return (
        <div className="layout-footer flex align-items-center">
            <img
                src="/clean_vpn_logo.jpg"
                alt="CleanVPN logo"
                width="14"
                height="14"
                className="mr-2"
                style={{
                    objectFit: 'contain',
                    borderRadius: '4px'
                }}
            />

            <span className="font-medium ml-1">Clean Pay</span>
        </div>
    );
};

export default AppFooter;