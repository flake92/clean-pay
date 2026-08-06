import AppMenu from './AppMenu';
import type { NavigationViewModel } from '@/shared/presentation/navigation';

const AppSidebar = ({ navigation }: { navigation: NavigationViewModel }) => {
    return <AppMenu navigation={navigation} />;
};

export default AppSidebar;
