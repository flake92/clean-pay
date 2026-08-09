import AppMenu from './AppMenu';
import type { NavigationViewModel } from '@/application/models/navigation';

const AppSidebar = ({ navigation }: { navigation: NavigationViewModel }) => {
    return <AppMenu navigation={navigation} />;
};

export default AppSidebar;
