export interface User {
  id: number;
  uuid: string;
  nombre: string;
  producerSize: string | null;
  email: string;
  isFarmer: boolean;
  created_at: string | null;
  updated_at: string | null;
  apellido_p: string;
  apellido_m: string;
  active_u: boolean;
  photourl: string | null;
}