import Image from "next/image";
import { APP_VERSION } from "@/shared/app-version";
import { getBranding } from "@/shared/branding";

const AppFooter = () => {
    const branding = getBranding();

    return (
        <footer className="layout-footer flex align-items-center">
            <Image
                src={branding.logoUrl}
                alt=""
                width={14}
                height={14}
                unoptimized
                className="mr-2"
                style={{
                    objectFit: "contain",
                    borderRadius: "4px"
                }}
            />

            <span className="font-medium ml-1">{branding.name}</span>
            <span aria-label={`Версия приложения ${APP_VERSION}`} className="text-600 text-sm ml-2">
                Версия {APP_VERSION}
            </span>
        </footer>
    );
};

export default AppFooter;
