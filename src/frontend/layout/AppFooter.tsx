import Image from "next/image";
import React from "react";
import { getBranding } from "@/shared/branding";

const AppFooter = () => {
    const branding = getBranding();

    return (
        <div className="layout-footer flex align-items-center">
            <Image
                src={branding.logoUrl}
                alt={`${branding.name} logo`}
                width={14}
                height={14}
                className="mr-2"
                style={{
                    objectFit: "contain",
                    borderRadius: "4px"
                }}
            />

            <span className="font-medium ml-1">{branding.name}</span>
        </div>
    );
};

export default AppFooter;
