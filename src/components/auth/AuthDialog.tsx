import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoginForm } from './LoginForm';

/** Modal wrapper around the shared inline LoginForm. */
const AuthDialog: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => (
  <Dialog open={isOpen} onOpenChange={onClose}>
    <DialogContent className="max-h-[90dvh] max-w-[95vw] gap-0 overflow-hidden overflow-y-auto rounded-sm p-0 sm:max-w-sm">
      <DialogHeader className="px-6 pt-6">
        <DialogTitle className="text-lg font-semibold leading-none tracking-tight text-center">
          Log in
        </DialogTitle>
      </DialogHeader>
      <div className="px-6 pb-6 pt-4">
        {isOpen && <LoginForm onDone={onClose} />}
      </div>
    </DialogContent>
  </Dialog>
);

export default AuthDialog;
