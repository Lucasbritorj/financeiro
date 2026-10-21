import {beforeEach,expect,test,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
const m=vi.hoisted(()=>({sair:vi.fn(),push:vi.fn(),refresh:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:m.push,refresh:m.refresh})}));
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({auth:{signOut:m.sair}})}));
import SairBotao from '@/components/sair-botao';
beforeEach(()=>vi.clearAllMocks());
test('logout recusado informa erro e não redireciona como se tivesse saído',async()=>{
 m.sair.mockResolvedValue({error:{message:'internal secret'}});render(<SairBotao/>);fireEvent.click(screen.getByRole('button',{name:'Sair'}));expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível sair');expect(m.push).not.toHaveBeenCalled();
});
test('logout confirmado redireciona; cliques pendentes não repetem',async()=>{
 let resolver!:(value:{error:null})=>void;m.sair.mockReturnValue(new Promise(r=>{resolver=r;}));render(<SairBotao/>);const botao=screen.getByRole('button',{name:'Sair'});fireEvent.click(botao);fireEvent.click(botao);expect(m.sair).toHaveBeenCalledTimes(1);resolver({error:null});await waitFor(()=>expect(m.push).toHaveBeenCalledWith('/login'));
});
